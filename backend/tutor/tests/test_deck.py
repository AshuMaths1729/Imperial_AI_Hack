import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tutor import deck as decks
from tutor.router import get_deck_llm, get_store, tutor_router
from tutor.seed import demo_track
from tutor.store import make_store

FALLBACK = decks.fallback_deck("gradient-descent")
GD_KPS = ["gd1", "gd2", "gd3", "gd4"]


def tiny_deck(kp_ids=("gd1", "gd2", "gd3", "gd4")):
    return {"title": "T", "slides": [{
        "id": "s1", "title": "Slope", "kp_ids": list(kp_ids),
        "objects": [
            {"kind": "axes", "id": "ax", "x": 100, "y": 150, "w": 800, "h": 500, "x_range": [-3, 3], "y_range": [0, 6]},
            {"kind": "curve", "id": "c", "axes": "ax", "expr": "0.4*(x-0.5)^2+0.5"},
            {"kind": "dot", "id": "d", "axes": "ax", "curve": "c", "x": -2},
        ],
        "steps": [{"narration": "go", "actions": [{"do": "show", "ids": ["ax", "c"]}, {"do": "path", "id": "d", "xs": [-1, 0]}]}],
    }]}


def tool_reply(deck, use_id="tu1"):
    return {"content": [{"type": "tool_use", "id": use_id, "name": "make_deck", "input": deck}]}


class FakeLLM:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.bodies = []

    def __call__(self, body):
        self.bodies.append(copy.deepcopy(body))
        r = self.replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def test_schema_file_matches_models():
    on_disk = json.loads((decks.SLIDES_DIR / "deck.schema.json").read_text())
    assert on_disk == decks.Deck.model_json_schema(), "regenerate: python -m tutor.deck > ../frontend/src/tutor/slides/deck.schema.json"


def test_fallback_deck_is_valid_and_covers_demo_kps():
    deck, errs, missing = decks.parse_deck(FALLBACK, GD_KPS)
    assert errs == [] and missing == []
    assert 5 <= len(deck.slides) <= 8
    assert all(s.steps for s in deck.slides)


def test_fallback_rejects_path_tricks():
    assert decks.fallback_deck("../secrets") is None
    assert decks.fallback_deck("nope") is None


def test_cross_reference_errors():
    d = tiny_deck()
    s = d["slides"][0]
    s["objects"].append({"kind": "tangent", "id": "t", "curve": "d", "dot": "c"})
    s["objects"].append({"kind": "dot", "id": "d", "axes": "ax", "x": 0})  # duplicate id, no curve or y
    s["steps"].append({"narration": "x", "actions": [{"do": "move", "id": "c", "to": 1},
                                                    {"do": "show", "ids": ["ghost"]},
                                                    {"do": "morph", "id": "c", "latex": "x"}]})
    _, errs, _ = decks.parse_deck(d)
    text = "\n".join(errs)
    for needle in ["duplicate object id d", "t refers to d, which is not a curve", "t refers to c, which is not a dot",
                   "c is not a dot", "unknown object ghost", "morph needs latex for a math object or expr for a curve"]:
        assert needle in text, needle


def test_schema_errors_are_reported_not_raised():
    deck, errs, _ = decks.parse_deck({"title": "T", "slides": [{"id": "s", "title": "x", "objects": [{"kind": "blob", "id": "b"}]}]})
    assert deck is None and errs


def test_expr_check():
    assert decks.expr_error("0.4*(x-0.5)^2 + sin(PI*x)", set()) is None
    assert decks.expr_error("a*x^2", {"a"}) is None
    assert "unknown name" in decks.expr_error("a*x^2", set())
    assert "bad character" in decks.expr_error("x; alert(1)", set())


def test_unknown_kps_dropped_and_missing_reported():
    deck, errs, missing = decks.parse_deck(tiny_deck(["gd1", "zzz"]), GD_KPS)
    assert errs == [] and deck.slides[0].kp_ids == ["gd1"] and missing == ["gd2", "gd3", "gd4"]


def test_generate_retries_with_errors_then_succeeds():
    bad = tiny_deck()
    bad["slides"][0]["objects"][1]["axes"] = "nope"
    llm = FakeLLM(tool_reply(bad), tool_reply(tiny_deck(), "tu2"))
    deck, warnings = decks.generate_deck(demo_track(), llm)
    assert deck["slides"][0]["id"] == "s1" and warnings == []
    first, second = llm.bodies
    assert first["model"] == "claude-sonnet-5-5" and first["tool_choice"] == {"type": "auto"}
    assert "Momentum" in first["messages"][0]["content"]  # KPs are in the prompt
    feedback = second["messages"][-1]["content"][0]
    assert feedback["tool_use_id"] == "tu1" and "nope" in feedback["content"]


def test_generate_accepts_coverage_gaps_after_retry():
    llm = FakeLLM(tool_reply(tiny_deck(["gd1"])), tool_reply(tiny_deck(["gd1"]), "tu2"))
    deck, warnings = decks.generate_deck(demo_track(), llm)
    assert deck and warnings == ["not covered: gd2", "not covered: gd3", "not covered: gd4"]


def test_generate_raises_when_never_valid():
    with pytest.raises(ValueError):
        decks.generate_deck(demo_track(), FakeLLM({"content": []}, {"content": []}))


def test_materials_text_resolves_demo_dataset():
    text = decks.materials_text(demo_track())
    assert "COMP70050" in text and "quiz:" in text


# --- router ---------------------------------------------------------------

@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    store = make_store()
    llm = FakeLLM()
    app = FastAPI()
    app.include_router(tutor_router)
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_deck_llm] = lambda: llm
    return TestClient(app), store, llm


def test_get_deck_serves_fallback_before_generation(env):
    client, _, _ = env
    body = client.get("/api/tutor/tracks/gradient-descent/deck").json()
    assert body["status"] == "none" and body["source"] == "fallback" and body["deck"]["slides"]
    assert client.get("/api/tutor/tracks/nope/deck").status_code == 404


def test_track_without_fallback_has_no_deck(env):
    client, _, _ = env
    tid = client.post("/api/tutor/tracks", json={"title": "X"}).json()["track_id"]
    body = client.get(f"/api/tutor/tracks/{tid}/deck").json()
    assert body["deck"] is None and body["source"] is None


def test_post_generates_in_background_and_caches(env):
    client, store, llm = env
    llm.replies.append(tool_reply(tiny_deck()))
    started = client.post("/api/tutor/tracks/gradient-descent/deck").json()
    assert started["status"] == "generating"
    body = client.get("/api/tutor/tracks/gradient-descent/deck").json()  # TestClient ran the background task
    assert body["status"] == "ready" and body["source"] == "generated" and body["deck"]["slides"][0]["id"] == "s1"
    assert store.get_deck("gradient-descent")["status"] == "ready"


def test_failed_regeneration_keeps_previous_deck(env):
    client, store, llm = env
    llm.replies += [tool_reply(tiny_deck()), RuntimeError("API down")]
    client.post("/api/tutor/tracks/gradient-descent/deck")
    client.post("/api/tutor/tracks/gradient-descent/deck")
    body = client.get("/api/tutor/tracks/gradient-descent/deck").json()
    assert body["status"] == "failed" and "API down" in body["error"]
    assert body["source"] == "generated" and body["deck"]["slides"][0]["id"] == "s1"


def test_post_while_generating_does_not_start_another(env):
    client, store, llm = env
    store.save_deck("gradient-descent", {"status": "generating", "updated_at": decks.now()})
    assert client.post("/api/tutor/tracks/gradient-descent/deck").json()["status"] == "generating"
    assert llm.bodies == []


def test_stale_generating_doc_is_restarted(env):
    client, store, llm = env
    store.save_deck("gradient-descent", {"status": "generating", "updated_at": "2020-01-01T00:00:00+00:00"})
    llm.replies.append(tool_reply(tiny_deck()))
    client.post("/api/tutor/tracks/gradient-descent/deck")
    assert len(llm.bodies) == 1
