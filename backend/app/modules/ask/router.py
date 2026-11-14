from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps import get_llm, get_settings
from app.llm.client import LLMClient
from app.modules.ask.service import answer_spatial
from app.schemas.ask import AskSpatialRequest, AskSpatialResponse
from app.settings import Settings

router = APIRouter(tags=["ask"])


@router.post("/ask-spatial/v2", response_model=AskSpatialResponse)
async def ask_spatial_v2(
    req: AskSpatialRequest,
    llm: LLMClient = Depends(get_llm),
    settings: Settings = Depends(get_settings),
) -> AskSpatialResponse:
    return await answer_spatial(req, llm, settings)
