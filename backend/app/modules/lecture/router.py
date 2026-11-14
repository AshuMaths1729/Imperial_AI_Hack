"""Lecture ingestion (PDF -> concept graph), graph reads and document page images."""

from __future__ import annotations

import base64
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import Field

from app.core.errors import NotFound
from app.deps import get_llm, get_settings
from app.llm.client import LLMClient
from app.modules.lecture import pdfdoc
from app.modules.lecture.drafts import LectureDraft
from app.modules.lecture.prompts import EXTRACT_PROMPT, PROMPT_VERSION, extract_instructions
from app.modules.lecture.service import draft_to_graph, graph_id_for
from app.modules.lecture.store import graph_path, load_graph, save_graph
from app.schemas.base import StrictModel
from app.schemas.graph import Graph
from app.settings import Settings

router = APIRouter(tags=["lecture"])


class IngestLectureResponse(StrictModel):
    graph_id: str
    doc_id: str
    graph: Graph
    page_count: int
    truncated: bool = Field(description="True if only the first 100 pages were processed")


class PageInfo(StrictModel):
    page: int
    snippet: str


class DocInfo(StrictModel):
    doc_id: str
    filename: str
    page_count: int
    total_pages: int
    truncated: bool
    pages: list[PageInfo]


@router.post("/ingest/lecture", response_model=IngestLectureResponse)
async def ingest_lecture(
    file: UploadFile = File(...),
    force: bool = Query(default=False, description="Re-run extraction even if cached on disk"),
    settings: Settings = Depends(get_settings),
    llm: LLMClient = Depends(get_llm),
) -> IngestLectureResponse:
    pdf = await file.read()
    meta = await run_in_threadpool(pdfdoc.process_pdf, pdf, settings.state_dir, file.filename or "")
    doc_id, count = meta["doc_id"], meta["page_count"]
    gid = graph_id_for(doc_id)

    if not force and graph_path(settings, gid).exists():  # idempotent re-upload
        graph = load_graph(settings, gid)
    else:
        llm_pdf = await run_in_threadpool(pdfdoc.pdf_for_llm, pdf, count, meta["total_pages"])
        content = [
            {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": base64.b64encode(llm_pdf).decode("ascii"),
                },
            },
            {
                "type": "text",
                "text": extract_instructions(
                    count, meta["total_pages"] if meta["truncated"] else None
                ),
            },
        ]
        result = await llm.parse(
            "lecture.extract", EXTRACT_PROMPT, content, LectureDraft, prompt_version=PROMPT_VERSION
        )
        graph = draft_to_graph(result.output, doc_id, count)
        save_graph(settings, graph)

    return IngestLectureResponse(
        graph_id=gid, doc_id=doc_id, graph=graph, page_count=count, truncated=meta["truncated"]
    )


@router.get("/graphs/{graph_id}", response_model=Graph)
async def get_graph(graph_id: str, settings: Settings = Depends(get_settings)) -> Graph:
    return load_graph(settings, graph_id)


def _meta_or_404(settings: Settings, doc_id: str) -> dict[str, Any]:
    meta = pdfdoc.read_meta(settings.state_dir, doc_id) if pdfdoc.DOC_ID_RE.match(doc_id) else None
    if meta is None:
        raise NotFound(f"Unknown document {doc_id!r}")
    return meta


@router.get("/docs/{doc_id}", response_model=DocInfo)
async def get_doc(doc_id: str, settings: Settings = Depends(get_settings)) -> DocInfo:
    meta = _meta_or_404(settings, doc_id)
    pages_file = pdfdoc.docs_dir(settings.state_dir, doc_id) / "pages.json"
    texts = json.loads(pages_file.read_text(encoding="utf-8"))
    return DocInfo(
        **meta,
        pages=[
            PageInfo(page=i + 1, snippet=" ".join(t.split())[:300]) for i, t in enumerate(texts)
        ],
    )


@router.get("/docs/{doc_id}/pages/{n}.png")
async def get_page_image(
    doc_id: str,
    n: int,
    size: Literal["thumb", "full"] = "full",
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    meta = _meta_or_404(settings, doc_id)
    if not 1 <= n <= meta["page_count"]:
        raise NotFound(f"Page {n} is out of range (1-{meta['page_count']})")
    prefix = "thumb" if size == "thumb" else "page"
    path = pdfdoc.docs_dir(settings.state_dir, doc_id) / f"{prefix}-{n}.png"
    if not path.exists():
        raise NotFound("Page image missing")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
