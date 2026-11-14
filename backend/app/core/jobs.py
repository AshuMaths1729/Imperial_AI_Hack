"""Job runner + progress events (swap point: in-process asyncio -> Arq/Redis or Celery).

A job is an async function `fn(ctx) -> result_id | None`. While it runs it reports progress
with `ctx.emit(...)`; the runner adds the terminal event itself:
  * `fn` returns            -> `{stage: "done",  pct: 100, result_id: <returned value>}`
  * `fn` raises             -> `{stage: "error", pct: <last pct>, message: <reason>}`

Pipelines are lists of named stages (`run_stages`): each stage is an idempotent async
function `(ctx, input) -> output`; the runner emits one progress event per stage.

WP0 ships the interfaces and a minimal `InProcessJobRunner`. C1 hardens it (retention,
cancellation, concurrency limits) and adds the SSE endpoint (replay from `seq`,
`Last-Event-ID` / `?last_event_id=`, heartbeats).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from app.core.errors import AppError, JobNotFound
from app.schemas.jobs import JobEvent

log = logging.getLogger(__name__)

JobFn = Callable[["JobContext"], Awaitable["str | None"]]
StageFn = Callable[["JobContext", Any], Awaitable[Any]]


class JobContext:
    """Handed to a job function. `emit` records a progress event and wakes subscribers."""

    def __init__(self, job_id: str, kind: str, sink: Callable[[JobEvent], None]) -> None:
        self.job_id = job_id
        self.kind = kind
        self._sink = sink
        self._seq = 0
        self.last_pct = 0.0

    def emit(
        self,
        stage: str,
        pct: float,
        message: str | None = None,
        result_id: str | None = None,
    ) -> JobEvent:
        """Record a progress event (`pct` is overall progress, 0-100). Never blocks."""
        pct = max(0.0, min(100.0, float(pct)))
        event = JobEvent(
            seq=self._seq, stage=stage, pct=pct, message=message, result_id=result_id
        )
        self._seq += 1
        if not event.is_terminal:
            self.last_pct = pct
        self._sink(event)
        return event


@runtime_checkable
class JobRunner(Protocol):
    def submit(self, kind: str, fn: JobFn) -> str:
        """Start `fn` in the background and return its job id (needs a running event loop)."""
        ...

    def subscribe(self, job_id: str, after_seq: int = -1) -> AsyncIterator[JobEvent]:
        """Replay events with `seq > after_seq`, then follow live until the terminal event.

        Raises `JobNotFound` for an unknown id.
        """
        ...


# ----------------------------------------------------------------------------- stages
@dataclass(frozen=True)
class Stage:
    name: str
    fn: StageFn
    weight: float = 1.0  # relative share of the overall progress bar


StageLike = Stage | tuple[str, StageFn]


async def run_stages(ctx: JobContext, stages: Sequence[StageLike], input: Any) -> Any:  # noqa: A002
    """Run named stages in order, emitting one event as each starts; returns the last output.

    The event for a stage carries the progress made *before* it, so the bar reaches 100 only
    with the runner's terminal `done` event.
    """
    items = [s if isinstance(s, Stage) else Stage(s[0], s[1]) for s in stages]
    total = sum(s.weight for s in items) or 1.0
    done = 0.0
    value = input
    for s in items:
        ctx.emit(s.name, 100.0 * done / total, f"{s.name}")
        value = await s.fn(ctx, value)
        done += s.weight
    return value


# ------------------------------------------------------------------ in-process runner
@dataclass
class _Job:
    id: str
    kind: str
    events: list[JobEvent] = field(default_factory=list)
    waiters: list[asyncio.Future[None]] = field(default_factory=list)
    task: asyncio.Task[None] | None = None

    @property
    def finished(self) -> bool:
        return bool(self.events) and self.events[-1].is_terminal


class InProcessJobRunner:
    """asyncio tasks + an in-memory event log. Jobs are lost on restart (stages are
    idempotent and cached, so a re-submit resumes cheaply)."""

    def __init__(self) -> None:
        self._jobs: dict[str, _Job] = {}

    def submit(self, kind: str, fn: JobFn) -> str:
        job = _Job(id=f"j_{uuid.uuid4().hex[:12]}", kind=kind)
        self._jobs[job.id] = job
        ctx = JobContext(job.id, kind, lambda ev: self._record(job, ev))
        job.task = asyncio.get_running_loop().create_task(self._run(job, ctx, fn))
        return job.id

    def get_events(self, job_id: str) -> list[JobEvent]:
        """Snapshot of the events recorded so far (for tests and polling endpoints)."""
        return list(self._job(job_id).events)

    async def wait(self, job_id: str) -> None:
        """Wait until the job's task has finished."""
        task = self._job(job_id).task
        if task is not None:
            await task

    def subscribe(self, job_id: str, after_seq: int = -1) -> AsyncIterator[JobEvent]:
        job = self._job(job_id)  # raises JobNotFound now, not on first iteration
        return self._follow(job, after_seq)

    async def _follow(self, job: _Job, after_seq: int) -> AsyncIterator[JobEvent]:
        last = after_seq
        while True:
            pending = [e for e in job.events if e.seq > last]
            for event in pending:
                last = event.seq
                yield event
                if event.is_terminal:
                    return
            if job.finished and not pending:
                return
            # No await happens between the check above and registering the waiter, so an
            # event emitted later always resolves it.
            waiter: asyncio.Future[None] = asyncio.get_running_loop().create_future()
            job.waiters.append(waiter)
            await waiter

    # -- internals
    def _job(self, job_id: str) -> _Job:
        try:
            return self._jobs[job_id]
        except KeyError:
            raise JobNotFound(f"Unknown job {job_id}") from None

    @staticmethod
    def _record(job: _Job, event: JobEvent) -> None:
        job.events.append(event)
        waiters, job.waiters = job.waiters, []
        for w in waiters:
            if not w.done():
                w.set_result(None)

    async def _run(self, job: _Job, ctx: JobContext, fn: JobFn) -> None:
        try:
            result_id = await fn(ctx)
        except asyncio.CancelledError:
            ctx.emit("error", ctx.last_pct, "Job cancelled")
            raise
        except AppError as exc:
            log.warning("job %s (%s) failed: %s", job.id, job.kind, exc.message)
            ctx.emit("error", ctx.last_pct, f"{exc.code}: {exc.message}")
        except Exception as exc:
            log.exception("job %s (%s) crashed", job.id, job.kind)
            ctx.emit("error", ctx.last_pct, f"{type(exc).__name__}: {exc}")
        else:
            ctx.emit("done", 100.0, None, result_id)
