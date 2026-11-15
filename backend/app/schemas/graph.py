"""Graph JSON (guide §3.3), shared by LectureGraph and HypothesisGraph.

Edge colours (frontend): blue = prerequisite, green = supports, red = contradicts,
dashed grey = gap (untested). Prerequisite edges must be acyclic.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.schemas.base import StrictModel

GraphKind = Literal["lecture", "hypothesis"]
NodeKind = Literal["concept", "claim", "paper"]
EdgeType = Literal["prerequisite", "supports", "contradicts", "gap"]
ExtractorName = Literal["frontier", "finetuned"]


class SourceRef(StrictModel):
    doc_id: str
    page: int | None = Field(
        default=None, ge=1, description="Slide number for lectures, page for papers"
    )


class Node(StrictModel):
    id: str
    kind: NodeKind
    label: str
    summary: str = ""
    source_ref: SourceRef | None = None
    # optional extra (paper nodes of a HypothesisGraph)
    authors_year: str | None = None


class Evidence(StrictModel):
    paper_id: str
    quote: str


class Edge(StrictModel):
    id: str
    source: str
    target: str
    type: EdgeType
    condition: str | None = Field(default=None, description='e.g. "at T > 60 °C"')
    evidence: list[Evidence] = Field(default_factory=list)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class GraphMeta(StrictModel):
    extractor_used: ExtractorName
    created_at: datetime


class Graph(StrictModel):
    graph_id: str
    kind: GraphKind
    nodes: list[Node]
    edges: list[Edge]
    meta: GraphMeta

    @model_validator(mode="after")
    def _check_integrity(self) -> Graph:
        node_ids = [n.id for n in self.nodes]
        if len(set(node_ids)) != len(node_ids):
            raise ValueError("duplicate node ids")
        edge_ids = [e.id for e in self.edges]
        if len(set(edge_ids)) != len(edge_ids):
            raise ValueError("duplicate edge ids")
        known = set(node_ids)
        for e in self.edges:
            if e.source not in known or e.target not in known:
                raise ValueError(f"edge {e.id} references an unknown node")
            if e.source == e.target:
                raise ValueError(f"edge {e.id} is a self-loop")
        cycle = find_prerequisite_cycle(self)
        if cycle:
            raise ValueError("prerequisite edges contain a cycle: " + " -> ".join(cycle))
        return self


def find_prerequisite_cycle(graph: Graph) -> list[str] | None:
    """Return one cycle (as a node-id path) over prerequisite edges, or None if acyclic."""
    adj: dict[str, list[str]] = {}
    for e in graph.edges:
        if e.type == "prerequisite":
            adj.setdefault(e.source, []).append(e.target)

    WHITE, GREY, BLACK = 0, 1, 2
    colour: dict[str, int] = {}
    stack: list[str] = []

    def visit(n: str) -> list[str] | None:
        colour[n] = GREY
        stack.append(n)
        for m in adj.get(n, ()):
            c = colour.get(m, WHITE)
            if c == GREY:
                return [*stack[stack.index(m) :], m]
            if c == WHITE:
                found = visit(m)
                if found:
                    return found
        stack.pop()
        colour[n] = BLACK
        return None

    for start in list(adj):
        if colour.get(start, WHITE) == WHITE:
            found = visit(start)
            if found:
                return found
    return None
