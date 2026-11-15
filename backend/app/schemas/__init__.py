"""Shared contracts (guide §3.3) as Pydantic v2 models.

WP0 owns this package. Later schema changes go in small separate merges to `main`, followed
by `uv run python scripts/export_openapi.py` and `npm run gen:types` in `frontend/`.
Track-specific schemas (`claims.py`, `quiz.py`, sim specs) are added by their tracks.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.ask import (
    ActiveContext,
    Annotation,
    AskSpatialRequest,
    AskSpatialResponse,
    CalloutBox,
    CircleRegion,
    DrawArrow,
    FollowUp,
    HighlightEdge,
    HitMetadata,
    PlotRange,
    PulseNode,
    Segment,
    ShowCard,
)
from app.schemas.graph import Edge, Evidence, Graph, GraphMeta, Node, SourceRef
from app.schemas.health import ErrorBody, ErrorEnvelope, HealthResponse
from app.schemas.jobs import TERMINAL_STAGES, JobCreated, JobEvent
from app.schemas.sim import ParamSpec, Series, SimOutput, SimPayload

# Models that must appear in the generated OpenAPI (and therefore in the TypeScript types)
# even when no route references them yet. (model, mode): "serialization" = we send it,
# "validation" = we receive it.
CONTRACT_MODELS: list[tuple[type[BaseModel], str]] = [
    (Graph, "serialization"),
    (SimPayload, "serialization"),
    (JobEvent, "serialization"),
    (JobCreated, "serialization"),
    (AskSpatialRequest, "validation"),
    (AskSpatialResponse, "serialization"),
    (HealthResponse, "serialization"),
    (ErrorEnvelope, "serialization"),
]

__all__ = [
    "CONTRACT_MODELS",
    "TERMINAL_STAGES",
    "ActiveContext",
    "Annotation",
    "AskSpatialRequest",
    "AskSpatialResponse",
    "CalloutBox",
    "CircleRegion",
    "DrawArrow",
    "Edge",
    "ErrorBody",
    "ErrorEnvelope",
    "Evidence",
    "FollowUp",
    "Graph",
    "GraphMeta",
    "HealthResponse",
    "HighlightEdge",
    "HitMetadata",
    "JobCreated",
    "JobEvent",
    "Node",
    "ParamSpec",
    "PlotRange",
    "PulseNode",
    "Segment",
    "Series",
    "ShowCard",
    "SimOutput",
    "SimPayload",
    "SourceRef",
]
