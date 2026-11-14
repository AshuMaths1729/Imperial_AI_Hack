"""Graph persistence shared by convention with the topic lane: `state_dir/graphs/{id}.json`."""

from __future__ import annotations

import re
from pathlib import Path

from app.core.errors import NotFound
from app.modules.lecture.pdfdoc import write_json
from app.schemas.graph import Graph
from app.settings import Settings

GRAPH_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")
DEMO_FIXTURES = {
    "g_demo_lecture": "lecture_graph.json",
    "g_demo_hypothesis": "hypothesis_graph.json",
}


def graph_path(settings: Settings, graph_id: str) -> Path:
    return settings.state_dir / "graphs" / f"{graph_id}.json"


def save_graph(settings: Settings, graph: Graph) -> None:
    write_json(graph_path(settings, graph.graph_id), graph.model_dump(mode="json"))


def load_graph(settings: Settings, graph_id: str) -> Graph:
    if not GRAPH_ID_RE.match(graph_id):
        raise NotFound(f"Unknown graph {graph_id!r}")
    path = graph_path(settings, graph_id)
    if not path.exists() and graph_id in DEMO_FIXTURES:
        path = settings.fixtures_dir / DEMO_FIXTURES[graph_id]
    if not path.exists():
        raise NotFound(f"Unknown graph {graph_id!r}")
    return Graph.model_validate_json(path.read_text(encoding="utf-8"))
