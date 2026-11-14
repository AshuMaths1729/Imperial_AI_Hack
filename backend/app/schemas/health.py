"""`GET /api/health` (drives the frontend's offline badge) and the shared error envelope."""

from __future__ import annotations

from typing import Any, Literal

from app.schemas.base import StrictModel


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"
    cache_mode: Literal["live", "offline", "refresh"]
    preset: str | None = None  # name of the loaded Demo Preset, if any


class ErrorBody(StrictModel):
    code: str  # stable machine-readable code, e.g. "offline_cache_miss"
    message: str
    details: dict[str, Any] | None = None


class ErrorEnvelope(StrictModel):
    """The one JSON shape of every error response (see `app.core.errors`)."""

    error: ErrorBody
