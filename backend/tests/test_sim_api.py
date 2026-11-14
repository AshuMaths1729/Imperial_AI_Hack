"""/api/sim/*: seeded demo sim, generate flow (FakeLLM), run clamping. No live calls."""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from app.deps import get_llm
from app.llm.testing import FakeLLM
from app.main import create_app
from app.modules.legacy.router import run_heavy_ball_sim
from app.modules.sim.service import run_cache
from app.settings import Settings

sim_router = importlib.import_module("app.modules.sim.router")  # the package re-exports `router`

GOOD_CODE = """\
import numpy as np

PARAMS = {
    "k": {"min": 0.0, "max": 2.0, "default": 1.0, "step": 0.1, "unit": "1/s", "label": "Rate k"},
}


def simulate(k):
    x = np.linspace(0.0, 1.0, 11)
    return {
        "title": "Linear",
        "x_label": "t",
        "y_label": "y",
        "series": [{"name": "y = k t", "x": x.tolist(), "y": (k * x).tolist()}],
    }
"""
BAD_STATIC = "import os\n" + GOOD_CODE
BAD_NAN = GOOD_CODE.replace("(k * x).tolist()", "(k * x / 0.0).tolist()")


def draft(code: str, title: str = "Linear model") -> dict:
    return {
        "title": title,
        "code": code,
        "explanation": "A line.",
        "assumptions": ["linear"],
        "equation_latex": "y = k t",
    }


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def client(tmp_path, fake_llm):
    run_cache._d.clear()
    app = create_app(Settings(_env_file=None, state_dir=tmp_path))
    app.dependency_overrides[get_llm] = lambda: fake_llm
    with TestClient(app) as c:
        c.state_dir = tmp_path
        yield c


# ----- seeded demo sim -----------------------------------------------------------------


def _assert_matches_legacy(output: dict, **params: float) -> None:
    xs, legacy = run_heavy_ball_sim(**params)
    assert len(output["series"]) == len(legacy) == 3
    for got, want in zip(output["series"], legacy, strict=True):
        assert got["name"] == want.name
        assert got["x"] == pytest.approx(xs, abs=1e-9)
        assert got["y"] == pytest.approx(want.y, abs=1e-3)


def test_seeded_sim_matches_legacy_defaults(client):
    r = client.get("/api/sim/sim_heavy_ball")
    assert r.status_code == 200
    body = r.json()
    assert body["sim_id"] == "sim_heavy_ball"
    assert set(body["params"]) == {"gamma", "eta", "theta0"}
    assert body["params"]["gamma"]["default"] == 0.35
    assert "def simulate" in body["python_code"]
    assert body["validation"]["status"] == "passed"
    _assert_matches_legacy(body["default_output"])


def test_seeded_sim_matches_legacy_other_params(client):
    r = client.post(
        "/api/sim/run",
        json={"sim_id": "sim_heavy_ball", "params": {"gamma": 1.0, "eta": 4.0, "theta0": 0.7}},
    )
    assert r.status_code == 200
    _assert_matches_legacy(r.json()["output"], gamma=1.0, eta=4.0, theta0=0.7)


def test_legacy_simulate_route_still_works(client):
    r = client.post("/api/simulate", json={"gamma": 0.35, "eta": 2.4, "theta0": 1.8})
    assert r.status_code == 200 and len(r.json()["series"]) == 3


# ----- generate flow -------------------------------------------------------------------


def test_generate_happy_path_persists_and_serves(client, fake_llm):
    fake_llm.queue("sim.codegen", draft(GOOD_CODE))
    r = client.post("/api/sim/generate", json={"paper_text": "dy/dt = k", "hint": "linear"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sim_id"].startswith("sim_") and len(body["sim_id"]) == 14
    assert body["validation"]["status"] == "passed"
    assert body["assumptions"] == ["linear"]
    assert body["equation_latex"] == "y = k t"
    assert body["params"]["k"]["max"] == 2.0
    assert body["default_output"]["series"][0]["y"][-1] == 1.0
    assert [c.route for c in fake_llm.calls] == ["sim.codegen"]
    text = " ".join(b["text"] for b in fake_llm.calls[0].content)
    assert "dy/dt = k" in text and "linear" in text
    assert (client.state_dir / "sims" / f"{body['sim_id']}.json").is_file()
    again = client.get(f"/api/sim/{body['sim_id']}")
    assert again.status_code == 200 and again.json()["python_code"] == GOOD_CODE


@pytest.mark.parametrize("bad", [BAD_STATIC, BAD_NAN])
def test_generate_repairs_bad_first_draft(client, fake_llm, bad):
    fake_llm.queue("sim.codegen", draft(bad)).queue("sim.repair", draft(GOOD_CODE, "Fixed"))
    r = client.post("/api/sim/generate", json={"paper_text": "p"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Fixed"
    assert [c.route for c in fake_llm.calls] == ["sim.codegen", "sim.repair"]
    # the repair call gets the previous code and the error report
    repair_text = fake_llm.calls[1].content[0]["text"]
    assert "E_STATIC" in repair_text or "E_OUTPUT" in repair_text
    assert "def simulate" in repair_text


def test_generate_two_failures_returns_422_with_report(client, fake_llm):
    fake_llm.queue("sim.codegen", draft(BAD_STATIC)).queue("sim.repair", draft(BAD_NAN))
    r = client.post("/api/sim/generate", json={"paper_text": "p"})
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "sim_validation_failed"
    assert err["details"]["attempts"] == 2
    assert err["details"]["validation"]["status"] == "failed"
    assert err["details"]["validation"]["errors"][0]["code"] == "E_OUTPUT"
    assert not (client.state_dir / "sims").exists()


def test_generate_requires_a_source(client):
    r = client.post("/api/sim/generate", json={"hint": "x"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "bad_request"


def test_generate_rejects_bad_arxiv_id(client):
    r = client.post("/api/sim/generate", json={"arxiv_id": "../../etc/passwd"})
    assert r.status_code == 422


def test_generate_arxiv_sends_pdf_document_block(client, fake_llm, monkeypatch):
    async def fake_fetch(arxiv_id, settings):
        assert arxiv_id == "1412.6980"
        return b"%PDF-1.4 fake"

    monkeypatch.setattr(sim_router, "_fetch_arxiv_pdf", fake_fetch)
    fake_llm.queue("sim.codegen", draft(GOOD_CODE))
    r = client.post("/api/sim/generate", json={"arxiv_id": "1412.6980"})
    assert r.status_code == 200, r.text
    assert r.json()["arxiv_id"] == "1412.6980"
    block = fake_llm.calls[0].content[0]
    assert block["type"] == "document" and block["source"]["media_type"] == "application/pdf"


def test_generate_from_uploaded_pdf(client, fake_llm):
    fake_llm.queue("sim.codegen", draft(GOOD_CODE))
    r = client.post(
        "/api/sim/generate-pdf",
        files={"file": ("p.pdf", b"%PDF-1.4 fake", "application/pdf")},
        data={"hint": "damped"},
    )
    assert r.status_code == 200, r.text
    assert fake_llm.calls[0].content[0]["type"] == "document"


# ----- run -----------------------------------------------------------------------------


def test_run_clamps_params_and_caches(client, fake_llm):
    fake_llm.queue("sim.codegen", draft(GOOD_CODE))
    sim_id = client.post("/api/sim/generate", json={"paper_text": "p"}).json()["sim_id"]

    r = client.post("/api/sim/run", json={"sim_id": sim_id, "params": {"k": 99.0, "zzz": 1.0}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["params"] == {"k": 2.0}  # clamped to max, unknown param dropped
    assert body["output"]["series"][0]["y"][-1] == pytest.approx(2.0)
    assert body["runner"] == "subprocess" and body["cached"] is False

    low = client.post("/api/sim/run", json={"sim_id": sim_id, "params": {"k": -5}}).json()
    assert low["params"] == {"k": 0.0}
    assert low["output"]["series"][0]["y"][-1] == 0.0

    default = client.post("/api/sim/run", json={"sim_id": sim_id, "params": {}}).json()
    assert default["params"] == {"k": 1.0}

    # same (code, params) again -> served from the cache; clamping maps 50 onto the same key
    again = client.post("/api/sim/run", json={"sim_id": sim_id, "params": {"k": 50}}).json()
    assert again["cached"] is True and again["output"] == body["output"]


def test_run_and_get_unknown_sim_404(client):
    assert client.post("/api/sim/run", json={"sim_id": "sim_nope", "params": {}}).status_code == 404
    assert client.get("/api/sim/sim_nope").status_code == 404
    assert client.get("/api/sim/..%2Fsecret").status_code in (404, 422)
