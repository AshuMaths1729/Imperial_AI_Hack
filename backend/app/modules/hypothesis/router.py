from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends

from app.deps import get_llm, get_settings
from app.llm.client import LLMClient
from app.modules.hypothesis.schemas import PaperOut, TopicRequest, TopicResult
from app.modules.hypothesis.service import build_topic_graph, load_paper
from app.settings import Settings

router = APIRouter(tags=["hypothesis"])


def get_scholarly_http() -> httpx.AsyncClient | None:
    """None = the service opens its own client. Tests override this with a MockTransport."""
    return None


@router.post("/topics", response_model=TopicResult)
async def create_topic(
    body: TopicRequest,
    llm: LLMClient = Depends(get_llm),
    settings: Settings = Depends(get_settings),
    http: httpx.AsyncClient | None = Depends(get_scholarly_http),
) -> TopicResult:
    """Search papers on a topic and build the claim/contradiction graph (synchronous)."""
    return await build_topic_graph(
        body.query, body.max_papers, llm=llm, settings=settings, http=http
    )


@router.get("/papers/{paper_id}", response_model=PaperOut)
async def get_paper(paper_id: str, settings: Settings = Depends(get_settings)) -> PaperOut:
    return load_paper(settings, paper_id)
