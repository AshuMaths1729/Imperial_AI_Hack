"""The contract models reject drift: unknown fields, broken graphs, bad annotations."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.schemas import (
    AskSpatialRequest,
    AskSpatialResponse,
    Graph,
    JobEvent,
    ParamSpec,
    Segment,
    SimOutput,
)

META = {"extractor_used": "frontier", "created_at": datetime(2026, 1, 1, tzinfo=UTC)}


def graph(nodes, edges):
    return {"graph_id": "g", "kind": "lecture", "nodes": nodes, "edges": edges, "meta": META}


def node(id_, kind="concept"):
    return {"id": id_, "kind": kind, "label": id_}


def edge(id_, s, t, type_="prerequisite"):
    return {"id": id_, "source": s, "target": t, "type": type_}


def test_graph_minimal_ok_and_defaults():
    g = Graph.model_validate(graph([node("a"), node("b")], [edge("e", "a", "b")]))
    assert g.edges[0].confidence == 1.0 and g.edges[0].evidence == []


@pytest.mark.parametrize(
    "bad",
    [
        graph([node("a"), node("a")], []),  # duplicate node id
        graph([node("a")], [edge("e", "a", "zzz")]),  # dangling edge
        graph([node("a")], [edge("e", "a", "a")]),  # self loop
        graph(
            [node("a"), node("b"), node("c")],
            [edge("1", "a", "b"), edge("2", "b", "c"), edge("3", "c", "a")],
        ),  # prerequisite cycle
    ],
)
def test_graph_integrity_violations(bad):
    with pytest.raises(ValidationError):
        Graph.model_validate(bad)


def test_cycle_over_non_prerequisite_edges_is_fine():
    Graph.model_validate(
        graph(
            [node("a", "claim"), node("b", "claim")],
            [edge("1", "a", "b", "supports"), edge("2", "b", "a", "contradicts")],
        )
    )


def test_unknown_fields_are_rejected():
    with pytest.raises(ValidationError):
        Graph.model_validate({**graph([], []), "title": "nope"})
    with pytest.raises(ValidationError):
        JobEvent.model_validate({"seq": 0, "stage": "x", "pct": 1, "oops": 1})


def test_param_spec_rules():
    ParamSpec(min=0, max=1, default=0.5, step=0.1, label="x")
    for bad in (
        {"min": 1, "max": 0, "default": 0.5},
        {"min": 0, "max": 1, "default": 2},
        {"min": 0, "max": 1, "default": 0.5, "step": 0},
    ):
        with pytest.raises(ValidationError):
            ParamSpec(**{"step": 0.1, "label": "x", **bad})


def test_sim_output_rejects_nan_and_length_mismatch_and_too_many_points():
    ok = {"name": "s", "x": [0, 1], "y": [0, 1]}
    base = {"title": "t", "x_label": "x", "y_label": "y"}
    SimOutput(**base, series=[ok])
    for bad in (
        {"name": "s", "x": [0, 1], "y": [0, float("nan")]},
        {"name": "s", "x": [0, 1], "y": [0]},
        {"name": "s", "x": list(range(5001)), "y": list(range(5001))},
    ):
        with pytest.raises(ValidationError):
            SimOutput(**base, series=[bad])


def test_annotation_space_rules():
    def seg(*anns):
        return Segment.model_validate({"text": "t", "ui_annotations": list(anns)})

    # valid in each space
    seg({"type": "draw_arrow", "space": "node", "target_id": "n1"})
    seg({"type": "draw_arrow", "space": "data", "x": 1, "y": 2})
    seg({"type": "circle_region", "space": "view", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.3})
    seg({"type": "callout_box", "space": "view", "x": 0.5, "y": 0.5, "label": "hi"})
    seg({"type": "pulse_node", "id": "n1"}, {"type": "highlight_edge", "id": "e1"})
    seg({"type": "show_card", "card": "quiz", "id": "n1"})
    # invalid
    for bad in (
        {"type": "draw_arrow", "space": "node"},  # needs target_id
        {"type": "draw_arrow", "space": "data", "x": 1},  # needs y
        {"type": "draw_arrow", "x": 1, "y": 2},  # needs space
        {"type": "circle_region", "space": "view", "x": 0, "y": 0},  # needs w, h
        {"type": "callout_box", "space": "view", "x": 0, "y": 0},  # needs label
        {"type": "unknown", "id": "x"},
    ):
        with pytest.raises(ValidationError):
            seg(bad)


def test_ask_request_roundtrip_with_guide_example():
    req = AskSpatialRequest.model_validate(
        {
            "transcript": "why does it spike here?",
            "cropped_image_base64": "AAAA",
            "hit_metadata": {
                "node_ids": [],
                "edge_ids": [],
                "plot_range": {"x": [2.1, 3.4], "y": [0.2, 0.9]},
                "bbox": [10, 20, 100, 80],
            },
            "active_context": {"view": "sim", "paper_id": "p", "params": {"gamma": 0.3}},
        }
    )
    assert req.hit_metadata.plot_range.x == (2.1, 3.4)


def test_ask_response_needs_at_least_one_segment():
    with pytest.raises(ValidationError):
        AskSpatialResponse(spoken_answer="x", segments=[])


def test_job_event_pct_bounds_and_terminal():
    assert JobEvent(seq=0, stage="done", pct=100, result_id="g").is_terminal
    assert not JobEvent(seq=0, stage="persist", pct=90).is_terminal
    with pytest.raises(ValidationError):
        JobEvent(seq=0, stage="x", pct=101)
