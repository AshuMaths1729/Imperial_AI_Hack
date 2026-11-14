"""Live smoke test: real Semantic Scholar / OpenAlex search plus the real LLM client.

Run explicitly:  uv run pytest -m live tests/live/test_topic_live.py
"""

from __future__ import annotations

import pytest

from app.settings import Settings
from app.tools.scholarly import search_papers

pytestmark = pytest.mark.live


async def test_live_search_returns_papers_with_abstracts():
    papers = await search_papers("solid-state battery electrolytes", 5, settings=Settings())
    assert papers
    assert all(p.abstract or p.tldr for p in papers)


async def test_live_topic_graph(tmp_path):
    from app.main import create_app
    from app.modules.hypothesis.service import build_topic_graph

    settings = Settings(state_dir=tmp_path)
    container = create_app(settings).state.container
    result = await build_topic_graph(
        "solid-state battery electrolytes", 8, llm=container.llm, settings=settings
    )
    assert result.graph.kind == "hypothesis"
    assert result.graph.nodes
