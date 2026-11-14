"""The fixture-backed stand-in endpoints."""

from __future__ import annotations

import json

import pytest

from app.schemas import AskSpatialResponse, Graph, JobEvent, SimPayload


def sse_events(text: str) -> list[JobEvent]:
    out = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        event = JobEvent.model_validate(json.loads(fields["data"]))
        assert int(fields["id"]) == event.seq
        out.append(event)
    return out


@pytest.mark.parametrize(
    ("graph_id", "kind"), [("g_demo_lecture", "lecture"), ("g_demo_hypothesis", "hypothesis")]
)
def test_get_graph(client, graph_id, kind):
    r = client.get(f"/api/graphs/{graph_id}")
    assert r.status_code == 200
    g = Graph.model_validate(r.json())
    assert g.graph_id == graph_id and g.kind == kind


def test_get_sim(client):
    r = client.get("/api/sim/sim_heavy_ball")
    assert r.status_code == 200
    body = r.json()  # the real sim route returns a superset (sim_id, validation, ...)
    fields = {k: v for k, v in body.items() if k in SimPayload.model_fields}
    assert SimPayload.model_validate(fields).params.keys() == {"gamma", "eta", "theta0"}


@pytest.mark.parametrize("path", ["/api/graphs/nope", "/api/sim/nope", "/api/jobs/nope/events"])
def test_unknown_ids_are_404_envelopes(client, path):
    r = client.get(path)
    assert r.status_code == 404
    assert r.json()["error"]["code"] in {"not_found", "job_not_found"}


def test_job_events_replay(client):
    r = client.get("/api/jobs/j_demo_lecture/events")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = sse_events(r.text)
    assert events[-1].stage == "done" and events[-1].result_id == "g_demo_lecture"


def test_job_events_resume(client):
    by_query = sse_events(client.get("/api/jobs/j_demo_lecture/events?last_event_id=3").text)
    assert [e.seq for e in by_query][0] == 4
    by_header = sse_events(
        client.get("/api/jobs/j_demo_lecture/events", headers={"Last-Event-ID": "3"}).text
    )
    assert by_header == by_query


@pytest.mark.parametrize("view", ["lecture", "sim", "hypothesis"])
def test_ask_spatial_v2_by_view(client, view):
    r = client.post(
        "/api/ask-spatial/v2",
        json={"transcript": "what is this?", "active_context": {"view": view}},
    )
    assert r.status_code == 200
    resp = AskSpatialResponse.model_validate(r.json())
    assert resp.segments and resp.spoken_answer


def test_ask_spatial_v2_rejects_old_shape(client):
    r = client.post("/api/ask-spatial/v2", json={"mode": "lecture", "transcript": "x"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
