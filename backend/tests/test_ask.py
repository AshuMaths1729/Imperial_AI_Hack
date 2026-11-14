"""POST /api/ask-spatial/v2: canned fallback and the Claude path (fake LLM)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.core.errors import LLMRefusal
from app.llm.testing import FakeLLM
from app.main import create_app
from app.schemas.ask import AskSpatialResponse
from app.settings import Settings

URL = "/api/ask-spatial/v2"


def body(view="lecture", **over):
    req = {
        "transcript": "what is this?",
        "hit_metadata": {"node_ids": ["n1"], "edge_ids": ["e1"]},
        "active_context": {"view": view},
    }
    req.update(over)
    return req


def make_client(tmp_path, llm=None, **settings_kw):
    settings = Settings(
        _env_file=None,
        fixtures_dir=tmp_path / "fixtures",
        state_dir=tmp_path / "state",
        **settings_kw,
    )
    app = create_app(settings)
    if llm is not None:
        app.state.container.llm = llm
    return TestClient(app), app


def model_reply(**over):
    reply = {
        "spoken_answer": "Gradients vanish here. Try the quiz.",
        "segments": [
            {
                "text": "Gradients vanish here.",
                "ui_annotations": [
                    {"type": "pulse_node", "id": "n1"},
                    {"type": "pulse_node", "id": "invented"},
                    {"type": "highlight_edge", "id": "e1"},
                    {"type": "highlight_edge", "id": "n1"},
                    {"type": "draw_arrow", "space": "node", "target_id": "ghost"},
                    {"type": "callout_box", "space": "view", "x": 0.2, "y": 0.3, "label": "here"},
                    {"type": "show_card", "card": "quiz", "id": "ghost"},
                ],
            },
            {"text": "Try the quiz.", "ui_annotations": []},
        ],
        "follow_up": {"type": "quiz", "node_id": "n1"},
        "avatar_state": "explaining",
    }
    reply.update(over)
    return reply


@pytest.mark.parametrize("view", ["lecture", "sim", "hypothesis"])
def test_canned_builtin_per_view(tmp_path, view):
    client, _ = make_client(tmp_path)
    r = client.post(URL, json=body(view))
    assert r.status_code == 200
    resp = AskSpatialResponse.model_validate(r.json())
    assert resp.spoken_answer and resp.segments


def test_canned_uses_fixture_when_present(tmp_path):
    fx = tmp_path / "fixtures"
    fx.mkdir()
    canned = AskSpatialResponse.model_validate(
        {"spoken_answer": "From fixture.", "segments": [{"text": "From fixture."}]}
    )
    (fx / "ask_spatial_sim.json").write_text(canned.model_dump_json(), encoding="utf-8")
    client, _ = make_client(tmp_path)
    assert client.post(URL, json=body("sim")).json()["spoken_answer"] == "From fixture."
    # other views still fall back to the built-in answer
    assert client.post(URL, json=body("lecture")).json()["spoken_answer"] != "From fixture."


def test_invalid_request_is_422(tmp_path):
    client, _ = make_client(tmp_path)
    r = client.post(URL, json={"transcript": "x"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_claude_path_validates_ids_and_sends_image(tmp_path):
    llm = FakeLLM().queue("ask", model_reply())
    client, _ = make_client(tmp_path, llm=llm, ask_backend="claude")
    r = client.post(URL, json=body(cropped_image_base64="data:image/png;base64,QUJD"))
    assert r.status_code == 200, r.text
    data = r.json()
    anns = data["segments"][0]["ui_annotations"]
    # unknown node / edge ids and the arrow to "ghost" are dropped; a card with an unknown id
    # is kept but loses the id; view-space annotations are untouched
    assert [(a["type"], a.get("id") or a.get("space")) for a in anns] == [
        ("pulse_node", "n1"),
        ("highlight_edge", "e1"),
        ("callout_box", "view"),
        ("show_card", None),
    ]
    assert data["follow_up"] == {"type": "quiz", "node_id": "n1"}

    (call,) = llm.calls
    assert call.route == "ask" and call.output is AskSpatialResponse
    image, text = call.content
    assert image["type"] == "image" and image["source"]["data"] == "QUJD"  # data-URL stripped
    payload = json.loads(text["text"].split("\n", 1)[1])
    assert payload["transcript"] == "what is this?"
    assert payload["hit_metadata"]["node_ids"] == ["n1"]
    assert payload["active_context"]["view"] == "lecture"


def test_claude_path_without_image_and_unknown_follow_up_dropped(tmp_path):
    reply = model_reply(follow_up={"type": "quiz", "node_id": "nope"})
    llm = FakeLLM().queue("ask", reply)
    client, _ = make_client(tmp_path, llm=llm, ask_backend="claude")
    data = client.post(URL, json=body()).json()
    assert data["follow_up"] is None
    assert llm.calls[0].content[0]["type"] == "text"  # no image block


def test_claude_path_includes_graph_from_state_dir(tmp_path):
    graphs = tmp_path / "state" / "graphs"
    graphs.mkdir(parents=True)
    graph = {
        "graph_id": "g1",
        "kind": "lecture",
        "nodes": [
            {"id": "n1", "kind": "concept", "label": "Backprop"},
            {"id": "n9", "kind": "concept", "label": "Chain rule", "summary": "d/dx"},
        ],
        "edges": [{"id": "e9", "source": "n9", "target": "n1", "type": "prerequisite"}],
        "meta": {"extractor_used": "frontier", "created_at": "2026-01-01T00:00:00Z"},
    }
    (graphs / "g1.json").write_text(json.dumps(graph), encoding="utf-8")
    reply = model_reply()
    reply["segments"][0]["ui_annotations"] = [
        {"type": "pulse_node", "id": "n9"},  # not hit, but in the graph: allowed
        {"type": "highlight_edge", "id": "e9"},
    ]
    llm = FakeLLM().queue("ask", reply)
    client, _ = make_client(tmp_path, llm=llm, ask_backend="claude")
    r = client.post(URL, json=body(active_context={"view": "lecture", "graph_id": "g1"}))
    anns = r.json()["segments"][0]["ui_annotations"]
    assert [a["id"] for a in anns] == ["n9", "e9"]
    payload = json.loads(llm.calls[0].content[-1]["text"].split("\n", 1)[1])
    assert [n["id"] for n in payload["graph"]["nodes"]] == ["n1", "n9"]


def test_graph_id_cannot_escape_state_dir(tmp_path):
    (tmp_path / "secret.json").write_text("{}", encoding="utf-8")
    llm = FakeLLM().queue("ask", model_reply())
    client, _ = make_client(tmp_path, llm=llm, ask_backend="claude")
    client.post(URL, json=body(active_context={"view": "lecture", "graph_id": "../../secret"}))
    assert "graph" not in json.loads(llm.calls[0].content[-1]["text"].split("\n", 1)[1])


def test_claude_failure_falls_back_to_canned(tmp_path):
    class Refusing(FakeLLM):
        async def parse(self, *a, **k):
            raise LLMRefusal("no")

    client, _ = make_client(tmp_path, llm=Refusing(), ask_backend="claude")
    r = client.post(URL, json=body("sim"))
    assert r.status_code == 200 and r.json()["segments"]

    # a FakeLLM with nothing queued (no API key configured) also degrades to canned
    client2, _ = make_client(tmp_path, ask_backend="claude")
    assert client2.post(URL, json=body("hypothesis")).status_code == 200


def test_canned_backend_never_calls_llm(tmp_path):
    llm = FakeLLM().queue("ask", model_reply())
    client, _ = make_client(tmp_path, llm=llm, ask_backend="canned")
    client.post(URL, json=body())
    assert llm.calls == []


def test_legacy_ask_spatial_still_works(client):
    r = client.post(
        "/api/ask-spatial",
        json={"mode": "lecture", "transcript": "hi", "hit_node_ids": ["n3"]},
    )
    assert r.status_code == 200 and "spoken_answer" in r.json()


def test_container_uses_real_llm_only_with_key(tmp_path):
    from app.core.cache import FileCacheStore, MemoryCacheStore
    from app.llm.anthropic_client import AnthropicLLM

    plain = create_app(
        Settings(_env_file=None, anthropic_api_key=None, cache_dir=tmp_path / "c")
    ).state.container
    assert isinstance(plain.llm, FakeLLM) and isinstance(plain.cache, MemoryCacheStore)
    keyed = create_app(
        Settings(_env_file=None, anthropic_api_key="sk-test", cache_dir=tmp_path / "c")
    ).state.container
    assert isinstance(keyed.llm, AnthropicLLM) and isinstance(keyed.cache, FileCacheStore)
