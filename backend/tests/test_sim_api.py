"""/api/sim/*: generate flow (FakeLLM), run clamping. No live calls."""

from __future__ import annotations

import importlib

import pytest
from app.deps import get_llm
from app.llm.testing import FakeLLM
from app.main import create_app
from app.modules.sim.service import run_cache
from app.settings import Settings
from fastapi.testclient import TestClient

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


NO_SRC = {"section": "", "page": 0, "quote": ""}
CORE_DOCS = {
    "overview": "A line through the origin. Slope is k.",
    "key_findings": ["lines are straight"],
    "params": [
        {
            "key": "k",
            "symbol_latex": "$k$",
            "meaning": "slope",
            "effect": "steeper",
            "typical": "1",
            "source": {"section": "2 Model", "page": 2, "quote": "slope k"},
        },
        {
            "key": "old_name",
            "symbol_latex": "",
            "meaning": "renamed away",
            "effect": "x",
            "typical": "",
            "source": NO_SRC,
        },
    ],
    "presets": [
        {
            "name": "Steep",
            "description": "d",
            "values": [{"key": "k", "value": 5.0}],
            "expected": "steep line",
            "source": NO_SRC,
        },
    ],
    "series": [
        {"name": "y = k t", "meaning": "the line", "how_to_read": "up is more"},
        {"name": "gone", "meaning": "stale", "how_to_read": ""},
    ],
    "x_meaning": "time",
    "y_meaning": "height",
    "limitations": ["toy"],
}
GRAPH_DOCS = {
    "concepts": [
        {
            "id": "paper",
            "label": "Lines",
            "kind": "paper",
            "summary": "s",
            "detail": "",
            "latex": "",
            "param_key": "",
            "source": NO_SRC,
            "parents": [],
        },
        {
            "id": "model",
            "label": "Linear model",
            "kind": "model",
            "summary": "s",
            "detail": "",
            "latex": "y = k t",
            "param_key": "",
            "source": NO_SRC,
            "parents": [
                {
                    "source": "paper",
                    "relation": "proposes",
                    "explanation": "",
                    "kind": "prerequisite",
                }
            ],
        },
        {
            "id": "param_k",
            "label": "Slope k",
            "kind": "parameter",
            "summary": "s",
            "detail": "",
            "latex": "k",
            "param_key": "k",
            "source": NO_SRC,
            "parents": [
                {
                    "source": "model",
                    "relation": "is steepened by",
                    "explanation": "",
                    "kind": "prerequisite",
                }
            ],
        },
    ],
    "equations": [
        {
            "id": "eq1",
            "title": "Line",
            "latex": "$y = k t$",
            "explanation": "a line",
            "variables": [{"symbol_latex": "k", "meaning": "slope"}],
            "source": NO_SRC,
        },
    ],
    "derivation": [],
    "glossary": [{"symbol_latex": "k", "meaning": "slope"}],
}


def draft(code: str, title: str = "Linear model", docs: dict = CORE_DOCS) -> dict:
    """A `sim.codegen` reply (`SimDraft`)."""
    return {**repair(code, title), "paper_title": "Lines", "docs": docs}


def repair(code: str, title: str = "Linear model") -> dict:
    """A `sim.repair` reply (`RepairDraft`)."""
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
    # no sim.docs output queued -> that best-effort call fails, the sim still ships
    assert [c.route for c in fake_llm.calls] == ["sim.codegen", "sim.docs"]
    assert body["docs"]["overview"] == CORE_DOCS["overview"]
    assert body["docs"]["concepts"][0]["id"] == "paper"
    text = " ".join(b["text"] for b in fake_llm.calls[0].content)
    assert "dy/dt = k" in text and "linear" in text
    assert (client.state_dir / "sims" / f"{body['sim_id']}.json").is_file()
    again = client.get(f"/api/sim/{body['sim_id']}")
    assert again.status_code == 200 and again.json()["python_code"] == GOOD_CODE


@pytest.mark.parametrize("bad", [BAD_STATIC, BAD_NAN])
def test_generate_repairs_bad_first_draft(client, fake_llm, bad):
    fake_llm.queue("sim.codegen", draft(bad)).queue("sim.repair", repair(GOOD_CODE, "Fixed"))
    fake_llm.queue("sim.docs", GRAPH_DOCS)
    r = client.post("/api/sim/generate", json={"paper_text": "p"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Fixed"
    assert [c.route for c in fake_llm.calls] == ["sim.codegen", "sim.repair", "sim.docs"]
    # the repair call gets the previous code and the error report
    repair_text = fake_llm.calls[1].content[0]["text"]
    assert "E_STATIC" in repair_text or "E_OUTPUT" in repair_text
    assert "def simulate" in repair_text


def spy_on(fake_llm: FakeLLM) -> dict:
    seen: dict = {}
    real_parse = fake_llm.parse

    async def spy(route, prompt, content, output, **kw):
        seen[route] = {"content": content, **kw}
        return await real_parse(route, prompt, content, output, **kw)

    fake_llm.parse = spy
    return seen


def test_generate_merges_and_sanitises_both_docs_calls(client, fake_llm):
    seen = spy_on(fake_llm)
    fake_llm.queue("sim.codegen", draft(GOOD_CODE)).queue("sim.docs", GRAPH_DOCS)
    r = client.post("/api/sim/generate", json={"paper_text": "p", "hint": "h"})
    assert r.status_code == 200, r.text
    body = r.json()
    docs = body["docs"]
    assert [p["key"] for p in docs["params"]] == ["k"]
    assert docs["params"][0]["symbol_latex"] == "k"
    assert [s["name"] for s in docs["series"]] == ["y = k t"]
    assert docs["presets"][0]["params"] == {"k": 2.0}  # clamped to max
    assert docs["presets"][0]["source"] is None  # empty location
    assert [c["id"] for c in docs["concepts"]] == ["paper", "model", "param_k"]
    assert docs["concepts"][2]["param_key"] == "k"
    assert docs["concepts"][0]["param_key"] is None
    assert [(lk["source"], lk["target"], lk["relation"]) for lk in docs["links"]] == [
        ("paper", "model", "proposes"),
        ("model", "param_k", "is steepened by"),
    ]
    assert docs["equations"][0]["latex"] == "y = k t"
    assert body["paper_title"] == "Lines"
    # budgets / cache keys
    assert seen["sim.codegen"]["prompt_version"] == seen["sim.docs"]["prompt_version"] == "sim-v3"
    assert seen["sim.codegen"]["max_tokens"] == sim_router.CODEGEN_MAX_TOKENS
    assert seen["sim.docs"]["max_tokens"] == sim_router.DOCS_MAX_TOKENS
    # the docs call sees the paper and the validated sim, not the user hint
    docs_text = " ".join(b["text"] for b in seen["sim.docs"]["content"])
    assert "<paper>\np\n</paper>" in docs_text and "User hint" not in docs_text
    assert '"k": {"label": "Rate k"' in docs_text and '["y = k t"]' in docs_text
    assert "def simulate" in docs_text


def test_docs_call_failure_still_ships_with_minimal_graph(client, fake_llm):
    fake_llm.queue("sim.codegen", draft(GOOD_CODE)).queue("sim.docs", {"concepts": "nope"})
    r = client.post("/api/sim/generate", json={"paper_text": "p"})
    assert r.status_code == 200, r.text
    docs = r.json()["docs"]
    assert [(c["id"], c["kind"], c["param_key"]) for c in docs["concepts"]] == [
        ("paper", "paper", None),
        ("param_k", "parameter", "k"),
    ]
    assert docs["concepts"][0]["label"] == "Lines"
    assert docs["concepts"][1]["source"]["page"] == 2  # from the ParamDoc
    assert docs["params"][0]["key"] == "k" and docs["equations"] == []


def test_repair_keeps_codegen_docs_and_docs_call_sees_final_code(client, fake_llm):
    renamed = (
        GOOD_CODE.replace('"k"', '"rate"').replace("(k)", "(rate)").replace("k * x", "rate * x")
    )
    seen = spy_on(fake_llm)
    fake_llm.queue("sim.codegen", draft(BAD_STATIC)).queue("sim.repair", repair(renamed, "Fixed"))
    fake_llm.queue("sim.docs", GRAPH_DOCS)
    r = client.post("/api/sim/generate", json={"paper_text": "p"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert list(body["params"]) == ["rate"] and body["title"] == "Fixed"
    assert body["paper_title"] == "Lines"  # from codegen, the repair never sees the paper
    docs = body["docs"]
    assert docs["overview"] == CORE_DOCS["overview"]
    assert docs["params"] == []  # "k" no longer exists after the repair
    assert docs["presets"] == []  # only set "k"
    # the stale "k" concept is demoted, a "rate" parameter node is synthesised
    by_id = {c["id"]: c for c in docs["concepts"]}
    assert by_id["param_k"]["kind"] == "variable" and by_id["param_k"]["param_key"] is None
    assert [c["param_key"] for c in docs["concepts"] if c["param_key"]] == ["rate"]
    docs_text = " ".join(b["text"] for b in seen["sim.docs"]["content"])
    assert '"rate"' in docs_text and "import os" not in docs_text


def test_generate_two_failures_returns_422_with_report(client, fake_llm):
    fake_llm.queue("sim.codegen", draft(BAD_STATIC)).queue("sim.repair", repair(BAD_NAN))
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
