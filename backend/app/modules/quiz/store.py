"""Small JSON stores under `state_dir`: graphs (read), quizzes, mastery, page text (read).

Duplicates the graph-read convention of the lecture module on purpose: modules may not import
each other. Convention: `state_dir/graphs/{graph_id}.json`, `state_dir/docs/{doc_id}/pages.json`.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from app.core.errors import NotFound
from app.schemas.graph import Graph
from app.settings import Settings

GRAPH_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")
DEMO_FIXTURES = {
    "g_demo_lecture": "lecture_graph.json",
    "g_demo_hypothesis": "hypothesis_graph.json",
}
EMA_ALPHA = 0.35


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def load_graph(settings: Settings, graph_id: str) -> Graph:
    if not GRAPH_ID_RE.match(graph_id):
        raise NotFound(f"Unknown graph {graph_id!r}")
    path = settings.state_dir / "graphs" / f"{graph_id}.json"
    if not path.exists() and graph_id in DEMO_FIXTURES:
        path = settings.fixtures_dir / DEMO_FIXTURES[graph_id]
    if not path.exists():
        raise NotFound(f"Unknown graph {graph_id!r}")
    return Graph.model_validate_json(path.read_text(encoding="utf-8"))


def page_text(settings: Settings, doc_id: str, page: int) -> str:
    if not re.match(r"^[0-9a-f]{12}$", doc_id):
        return ""
    path = settings.state_dir / "docs" / doc_id / "pages.json"
    if not path.exists():
        return ""
    texts = json.loads(path.read_text(encoding="utf-8"))
    return texts[page - 1] if 1 <= page <= len(texts) else ""


def _quiz_path(settings: Settings, graph_id: str, node_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_\-]", "_", node_id)[:60]
    digest = hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:8]
    return settings.state_dir / "quizzes" / f"{graph_id}__{safe}_{digest}.json"


def read_quiz(settings: Settings, graph_id: str, node_id: str) -> list[dict[str, Any]] | None:
    path = _quiz_path(settings, graph_id, node_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def write_quiz(
    settings: Settings, graph_id: str, node_id: str, questions: list[dict[str, Any]]
) -> None:
    _write_json(_quiz_path(settings, graph_id, node_id), questions)


def _mastery_path(settings: Settings, graph_id: str) -> Path:
    return settings.state_dir / "mastery" / f"{graph_id}.json"


def read_mastery(settings: Settings, graph_id: str) -> dict[str, dict[str, Any]]:
    path = _mastery_path(settings, graph_id)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def record_answer(settings: Settings, graph_id: str, node_id: str, correct: bool) -> float:
    """EMA update (alpha 0.35, starting from 0.0); returns the node's new mastery."""
    state = read_mastery(settings, graph_id)
    entry = state.get(node_id) or {"mastery": 0.0, "attempts": 0, "correct": 0}
    entry["mastery"] = round(
        EMA_ALPHA * (1.0 if correct else 0.0) + (1 - EMA_ALPHA) * entry["mastery"], 6
    )
    entry["attempts"] += 1
    entry["correct"] += int(correct)
    state[node_id] = entry
    _write_json(_mastery_path(settings, graph_id), state)
    return float(entry["mastery"])
