"""Live Paper2Sim generation against the real Claude client (skipped unless a key is set)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.llm.testing import FakeLLM
from app.main import create_app
from app.settings import Settings

PAPER = """
Polyak's heavy-ball method: theta_{t+1} = theta_t - eta * grad L(theta_t) + beta (theta_t -
theta_{t-1}). In the continuous limit this is the damped oscillator
theta'' + gamma theta' + eta grad L(theta) = 0 with friction gamma. For a quadratic loss
L = theta^2 / 2 the trajectory decays like exp(-gamma t / 2) when underdamped.
"""


@pytest.mark.live
def test_generate_with_real_model(tmp_path):
    settings = Settings(state_dir=tmp_path)
    if settings.anthropic_api_key is None:
        pytest.skip("ANTHROPIC_API_KEY not set")
    app = create_app(settings)
    if isinstance(app.state.container.llm, FakeLLM):
        pytest.skip("real LLM client not wired into the container yet")
    with TestClient(app) as client:
        r = client.post("/api/sim/generate", json={"paper_text": PAPER, "hint": "underdamped"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["validation"]["status"] == "passed"
        assert 1 <= len(body["params"]) <= 5
        run = client.post("/api/sim/run", json={"sim_id": body["sim_id"], "params": {}})
        assert run.status_code == 200
