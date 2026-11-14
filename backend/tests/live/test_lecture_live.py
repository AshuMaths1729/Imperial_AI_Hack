"""Live smoke test: a small generated PDF through the real LLM client.

Skipped by default (`-m "not live"`); also skips itself without an API key or while the
container still holds the FakeLLM (before the llm lane is merged).
"""

from __future__ import annotations

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.llm.testing import FakeLLM
from app.main import create_app
from app.schemas.graph import Graph, find_prerequisite_cycle
from app.settings import Settings

pytestmark = pytest.mark.live

SLIDES = [
    "Gradient descent: minimise a loss by repeatedly stepping against the gradient.",
    "Learning rate: the step size. Too large diverges, too small is slow. Needs gradient descent.",
    "Momentum: accumulate past gradients to smooth the updates. Builds on gradient descent.",
]


def test_ingest_lecture_live(tmp_path):
    settings = Settings(state_dir=tmp_path / "state")
    if settings.anthropic_api_key is None:
        pytest.skip("no ANTHROPIC_API_KEY")
    app = create_app(settings)
    if isinstance(app.state.container.llm, FakeLLM):
        pytest.skip("container still uses FakeLLM (llm lane not merged)")

    doc = pymupdf.open()
    for text in SLIDES:
        doc.new_page().insert_text((72, 72), text)
    with TestClient(app) as client:
        r = client.post(
            "/api/ingest/lecture",
            files={"file": ("lec.pdf", doc.tobytes(), "application/pdf")},
        )
    assert r.status_code == 200, r.text
    graph = Graph.model_validate(r.json()["graph"])
    assert len(graph.nodes) >= 2
    assert find_prerequisite_cycle(graph) is None
