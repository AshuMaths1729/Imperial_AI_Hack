"""One tiny real call. Skipped by default; run with
`uv run --env-file <path-to-.env> pytest -m live -q` (the key is read from the environment)."""

from __future__ import annotations

import os

import pytest
from pydantic import BaseModel

from app.core.cache import MemoryCacheStore
from app.llm.anthropic_client import AnthropicLLM
from app.settings import Settings

pytestmark = pytest.mark.live


class Capital(BaseModel):
    country: str
    capital: str


async def test_live_structured_parse():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        pytest.skip("ANTHROPIC_API_KEY not set")
    settings = Settings(_env_file=None, cache_mode="live")
    llm = AnthropicLLM(settings, MemoryCacheStore())
    res = await llm.parse(
        "ask", "Answer with the requested JSON only.", "Capital of France?", Capital, max_tokens=500
    )
    assert res.output.capital.lower() == "paris"
    assert not res.cached and res.usage.output_tokens > 0
    again = await llm.parse(
        "ask", "Answer with the requested JSON only.", "Capital of France?", Capital, max_tokens=500
    )
    assert again.cached
