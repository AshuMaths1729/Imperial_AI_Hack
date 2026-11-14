"""POST /api/ingest/paper, GET /api/ingest/paper/{paper_id}."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.errors import NotFound, OfflineCacheMiss
from app.deps import get_settings
from app.modules.paper_ingest import service
from app.modules.paper_ingest.models import PaperSource
from app.modules.paper_ingest.service import IngestError, PaperStore
from app.settings import Settings
from app.tools.registry import Registry
from app.tools.scholarly import arxiv

router = APIRouter(prefix="/ingest", tags=["ingest"])


def register(reg: Registry) -> None:
    """Nothing to register: no LLM, no brokered tools."""


async def get_http_client() -> AsyncIterator[httpx.AsyncClient]:
    """Overridable in tests: `app.dependency_overrides[get_http_client] = lambda: client`."""
    async with httpx.AsyncClient(
        timeout=arxiv.TIMEOUT_S,
        follow_redirects=True,
        headers={"User-Agent": arxiv.USER_AGENT},
    ) as client:
        yield client


@router.post("/paper", response_model=PaperSource)
async def ingest_paper(
    file: UploadFile | None = File(default=None, description="PDF upload"),
    arxiv_id: str | None = Form(default=None, description="e.g. 1503.01243 or arXiv:1503.01243v2"),
    url: str | None = Form(default=None, description="arXiv link, direct .pdf link or web page"),
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_http_client),
) -> PaperSource:
    service.require_one_source(file is not None, arxiv_id, url)
    store = PaperStore(settings.state_dir)

    if file is not None:
        data = await file.read()
        src = await service.ingest_upload(data)
        cached = store.load(src.paper_id)
        if cached:
            return cached
    elif arxiv_id and arxiv_id.strip():
        aid = arxiv.parse_arxiv_id(arxiv_id)
        if not aid:
            raise IngestError(f"not a valid arXiv id: {arxiv_id!r}")
        cached = store.load(service.arxiv_paper_id(aid))
        if cached:
            return cached
        if settings.is_offline:
            raise OfflineCacheMiss(f"arXiv {aid} is not in the local paper cache")
        src = await service.ingest_arxiv(aid, client)
    else:
        assert url is not None
        link = url.strip()
        aid = arxiv.parse_arxiv_id(link)
        if aid:
            cached = store.load(service.arxiv_paper_id(aid))
            if cached:
                return cached
        if settings.is_offline:
            raise OfflineCacheMiss("offline mode: cannot fetch URLs")
        src = await service.ingest_url(link, client)

    store.save(src)
    return src


@router.get("/paper/{paper_id}", response_model=PaperSource)
def get_paper(paper_id: str, settings: Settings = Depends(get_settings)) -> PaperSource:
    src = PaperStore(settings.state_dir).load(paper_id)
    if src is None:
        raise NotFound(f"Unknown paper {paper_id}")
    return src
