"""Job progress events (`GET /api/jobs/{id}/events`, server-sent events)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import StrictModel

TERMINAL_STAGES = ("done", "error")
TerminalStage = Literal["done", "error"]


class JobCreated(StrictModel):
    """Response of every endpoint that starts a job (`POST /ingest/*`, `POST /topics`, ...)."""

    job_id: str


class JobEvent(StrictModel):
    """One progress event.

    `seq` is per job, starts at 0 and is the SSE event id (resume with `Last-Event-ID` or
    `?last_event_id=`). A job always ends with exactly one terminal event: `stage == "done"`
    (with `result_id` if the job produced something) or `stage == "error"` (reason in
    `message`).
    """

    seq: int = Field(ge=0)
    stage: str
    pct: float = Field(ge=0, le=100, description="Overall progress, 0-100")
    message: str | None = None
    result_id: str | None = None

    @property
    def is_terminal(self) -> bool:
        return self.stage in TERMINAL_STAGES
