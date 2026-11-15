"""Every shared fixture validates against its schema (contract drift fails here)."""

from __future__ import annotations

import json

import pytest

from app.core.fixtures import FIXTURES_DIR, load_fixture
from app.schemas import AskSpatialResponse, Graph, JobEvent, SimPayload
from app.schemas.graph import find_prerequisite_cycle
from app.schemas.jobs import TERMINAL_STAGES

# fixture file -> schema. A new fixture must be listed here (checked below).
SCHEMA_FOR: dict[str, object] = {
    "lecture_graph": Graph,
    "hypothesis_graph": Graph,
    "sim_heavy_ball": SimPayload,
    "ask_spatial_lecture": AskSpatialResponse,
    "ask_spatial_sim": AskSpatialResponse,
    "ask_spatial_hypothesis": AskSpatialResponse,
    "job_events": list[JobEvent],
}


def test_every_fixture_file_is_covered():
    on_disk = {p.stem for p in FIXTURES_DIR.glob("*.json")}
    assert on_disk == set(SCHEMA_FOR)


@pytest.mark.parametrize("name", sorted(SCHEMA_FOR))
def test_fixture_validates(name):
    assert load_fixture(name, SCHEMA_FOR[name]) is not None


def test_lecture_graph_shape():
    g = load_fixture("lecture_graph", Graph)
    assert g.kind == "lecture"
    assert {n.kind for n in g.nodes} == {"concept"}
    assert {e.type for e in g.edges} == {"prerequisite"}
    assert find_prerequisite_cycle(g) is None
    assert all(n.source_ref and n.source_ref.page for n in g.nodes)


def test_hypothesis_graph_shape():
    g = load_fixture("hypothesis_graph", Graph)
    assert g.kind == "hypothesis"
    assert {n.kind for n in g.nodes} == {"claim", "paper"}
    types = {e.type for e in g.edges}
    assert {"supports", "contradicts", "gap"} <= types
    # contradicts edges carry a condition and evidence; quotes come from the paper's summary
    papers = {n.source_ref.doc_id: n for n in g.nodes if n.kind == "paper" and n.source_ref}
    for e in g.edges:
        if e.type == "contradicts":
            assert e.condition and e.evidence
        for ev in e.evidence:
            assert ev.quote in papers[ev.paper_id].summary


def test_sim_fixture_code_matches_default_output():
    """The fixture's python_code follows the simulation contract and reproduces its own
    default_output exactly (trusted fixture, so a plain exec is fine here)."""
    sim = load_fixture("sim_heavy_ball", SimPayload)
    assert sim.python_code
    ns: dict = {}
    exec(sim.python_code, ns)
    assert set(ns["PARAMS"]) == set(sim.params) == {"gamma", "eta", "theta0"}
    for key, spec in ns["PARAMS"].items():
        assert spec == sim.params[key].model_dump()
    defaults = {k: p.default for k, p in sim.params.items()}
    assert ns["simulate"](**defaults) == json.loads(sim.default_output.model_dump_json())


def test_job_events_end_with_done_and_result():
    events = load_fixture("job_events", list[JobEvent])
    assert [e.seq for e in events] == list(range(len(events)))
    assert [e.pct for e in events] == sorted(e.pct for e in events)
    assert events[-1].stage in TERMINAL_STAGES == ("done", "error")
    assert events[-1].stage == "done" and events[-1].result_id
    assert not any(e.is_terminal for e in events[:-1])


def test_ask_fixtures_reference_existing_ids():
    lecture = load_fixture("lecture_graph", Graph)
    hyp = load_fixture("hypothesis_graph", Graph)
    ids = {
        "ask_spatial_lecture": {n.id for n in lecture.nodes} | {e.id for e in lecture.edges},
        "ask_spatial_hypothesis": {n.id for n in hyp.nodes} | {e.id for e in hyp.edges},
    }
    for name, known in ids.items():
        resp = load_fixture(name, AskSpatialResponse)
        for seg in resp.segments:
            for a in seg.ui_annotations:
                ref = getattr(a, "id", None) or getattr(a, "target_id", None)
                if ref:
                    assert ref in known, (name, a)
        if resp.follow_up:
            assert resp.follow_up.node_id in known
