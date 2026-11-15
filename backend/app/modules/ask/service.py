"""Circle-to-Ask: one Claude call (or a canned answer) -> `AskSpatialResponse`.

`ASK_BACKEND=claude` sends the cropped image + transcript + hit metadata (+ the active graph
when it is on disk) in a single `llm.parse("ask", ...)`; any LLM-layer failure falls back to
the canned answer so the live demo never dies on a flaky call. `ASK_BACKEND=canned`
answers with a built-in generic reply.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.core.errors import AppError
from app.llm.client import LLMClient
from app.schemas.ask import (
    AskSpatialRequest,
    AskSpatialResponse,
    CalloutBox,
    CircleRegion,
    DrawArrow,
    HighlightEdge,
    PulseNode,
    Segment,
)
from app.schemas.graph import Graph
from app.settings import Settings

log = logging.getLogger(__name__)

PROMPT_VERSION = "ask-v1"
MAX_GRAPH_NODES = 80
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")

SYSTEM_PROMPT = """\
You are the voice of Athena, a study workspace with three views: "lecture" (a concept \
graph of lecture slides; edges are prerequisite / supports / contradicts), "sim" (a live \
parameter simulation plot) and "hypothesis" (a paper graph of supporting and contradicting \
evidence). The student circled a region of the current view and asked a question about it.

You receive: the cropped image of the circled region (when available), the spoken transcript, \
hit metadata (ids of the nodes / edges under the lasso, plot data range, pixel bbox), the \
active context (view, params), and, when available, the full graph as JSON.

Answer as a patient tutor in a spoken style:
- `spoken_answer`: 2-3 short sentences, no markdown, no lists. It must equal the segment texts \
joined with spaces.
- `segments`: split the answer into 1-3 consecutive pieces. Attach `ui_annotations` to the \
segment during which they should appear. Use few annotations (0-2 per segment).
- Annotation types: pulse_node {id}, highlight_edge {id}, draw_arrow / circle_region / \
callout_box {space, target_id or x,y (+w,h for circle_region), label}, show_card {card, id}.
- Node and edge ids in annotations MUST come verbatim from hit_metadata or the graph JSON. \
Never invent ids. For plots use space "data" (axis units) or "view" (0-1, origin top-left).
- Optionally set `follow_up` {"type":"quiz","node_id"} when a quick quiz on a known node \
would help, and `avatar_state` (explaining | emphatic | questioning).
- If the transcript or image is unclear, say what you can see and ask one short clarifying \
question in the answer. Ground claims in the graph / image; do not make up citations."""


# ----------------------------------------------------------------------------- entry point
async def answer_spatial(
    req: AskSpatialRequest, llm: LLMClient, settings: Settings
) -> AskSpatialResponse:
    use_claude = settings.ask_backend == "claude" or (
        settings.ask_backend == "auto" and settings.anthropic_api_key is not None
    )
    if use_claude:
        try:
            return await _ask_claude(req, llm, settings)
        except (AppError, NotImplementedError) as exc:
            log.warning("ask backend failed (%s); using canned answer", type(exc).__name__)
    return canned_answer(req, settings)


# ------------------------------------------------------------------------------- claude
async def _ask_claude(
    req: AskSpatialRequest, llm: LLMClient, settings: Settings
) -> AskSpatialResponse:
    graph = load_graph(settings, req.active_context.graph_id)
    content = build_content(req, graph)
    result = await llm.parse(
        "ask", SYSTEM_PROMPT, content, AskSpatialResponse, prompt_version=PROMPT_VERSION
    )
    node_ids, edge_ids = known_ids(req, graph)
    return sanitize(result.output, node_ids, edge_ids)


def load_graph(settings: Settings, graph_id: str | None) -> Graph | None:
    if not graph_id or not _SAFE_ID.match(graph_id) or ".." in graph_id:
        return None
    path = Path(settings.state_dir) / "graphs" / f"{graph_id}.json"
    try:
        return Graph.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        return None


def _strip_data_url(b64: str) -> str:
    return b64.split(",", 1)[1] if b64.startswith("data:") and "," in b64 else b64


def build_content(req: AskSpatialRequest, graph: Graph | None) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    if req.cropped_image_base64:
        blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": _strip_data_url(req.cropped_image_base64),
                },
            }
        )
    payload: dict[str, Any] = {
        "transcript": req.transcript,
        "active_context": req.active_context.model_dump(mode="json"),
        "hit_metadata": req.hit_metadata.model_dump(mode="json"),
    }
    if graph is not None:
        payload["graph"] = {
            "nodes": [
                {"id": n.id, "label": n.label, "summary": n.summary[:240]}
                for n in graph.nodes[:MAX_GRAPH_NODES]
            ],
            "edges": [
                {
                    "id": e.id,
                    "source": e.source,
                    "target": e.target,
                    "type": e.type,
                    "condition": e.condition,
                }
                for e in graph.edges
            ],
        }
    blocks.append(
        {
            "type": "text",
            "text": "Student question context (JSON):\n" + json.dumps(payload, ensure_ascii=False),
        }
    )
    return blocks


def known_ids(req: AskSpatialRequest, graph: Graph | None) -> tuple[set[str], set[str]]:
    nodes = set(req.hit_metadata.node_ids)
    edges = set(req.hit_metadata.edge_ids)
    if graph is not None:
        nodes |= {n.id for n in graph.nodes}
        edges |= {e.id for e in graph.edges}
    return nodes, edges


def sanitize(
    resp: AskSpatialResponse, node_ids: set[str], edge_ids: set[str]
) -> AskSpatialResponse:
    """Drop annotations that point at ids the model made up."""
    anchors = node_ids | edge_ids
    segments: list[Segment] = []
    for seg in resp.segments:
        kept: list[Any] = []
        for a in seg.ui_annotations:
            if isinstance(a, PulseNode):
                ok = a.id in node_ids
            elif isinstance(a, HighlightEdge):
                ok = a.id in edge_ids
            elif isinstance(a, DrawArrow | CircleRegion | CalloutBox):
                ok = a.space != "node" or (a.target_id or "") in anchors
            else:  # ShowCard: keep the card, drop an id we do not know
                ok = True
                if a.id is not None and a.id not in anchors:
                    a = a.model_copy(update={"id": None})
            if ok:
                kept.append(a)
        segments.append(seg.model_copy(update={"ui_annotations": kept}))
    follow_up = resp.follow_up
    if follow_up is not None and follow_up.node_id not in node_ids:
        follow_up = None
    return resp.model_copy(update={"segments": segments, "follow_up": follow_up})


# ------------------------------------------------------------------------------- canned
def canned_answer(req: AskSpatialRequest, settings: Settings) -> AskSpatialResponse:
    """Generic fallback used when Claude is unavailable (no key, or the call failed)."""
    return _builtin_canned(req)


def _builtin_canned(req: AskSpatialRequest) -> AskSpatialResponse:
    view = req.active_context.view
    hit = req.hit_metadata
    first_node = hit.node_ids[0] if hit.node_ids else None
    annotations: list[Any]
    if view == "lecture":
        text = (
            "This is the concept you circled. It builds on its prerequisites in the graph, "
            "so check those first. Try the quick quiz on the right to test yourself."
        )
        annotations = [PulseNode(id=first_node)] if first_node else []
    elif view == "sim":
        text = (
            "In the region you circled, the curve responds to the parameters you can adjust "
            "with the sliders. Move one slider and watch how this part of the plot changes."
        )
        annotations = [CalloutBox(space="view", x=0.5, y=0.4, label="Region of interest")]
    else:
        text = (
            "This part of the graph compares what different papers claim. Follow the red "
            "edges to see where results disagree and under which conditions."
        )
        if first_node:
            annotations = [PulseNode(id=first_node)]
        elif hit.edge_ids:
            annotations = [HighlightEdge(id=hit.edge_ids[0])]
        else:
            annotations = []
    return AskSpatialResponse(
        spoken_answer=text,
        segments=[Segment(text=text, ui_annotations=annotations)],
        avatar_state="explaining",
    )
