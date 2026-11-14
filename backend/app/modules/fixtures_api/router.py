"""Routes (all under /api):

  GET  /graphs/{graph_id}      g_demo_lecture | g_demo_hypothesis      -> Graph
  GET  /sim/{sim_id}           sim_heavy_ball                          -> SimPayload
  GET  /jobs/{job_id}/events   j_demo_lecture (replay of job_events.json), or the id of a job
                               in the in-process runner                -> text/event-stream
  POST /ask-spatial/v2         canned answer picked by active_context.view -> AskSpatialResponse

Unknown ids are 404. The legacy `/ask-spatial` keeps its old shape (see `modules/legacy`).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse

from app.core.errors import JobNotFound, NotFound
from app.core.fixtures import load_fixture
from app.core.jobs import JobRunner
from app.deps import get_jobs, get_settings
from app.schemas import AskSpatialRequest, AskSpatialResponse, Graph, JobEvent, SimPayload
from app.settings import Settings
from app.tools.registry import Registry

router = APIRouter(tags=["fixtures"])

GRAPH_FIXTURES = {"g_demo_lecture": "lecture_graph", "g_demo_hypothesis": "hypothesis_graph"}
SIM_FIXTURES = {"sim_heavy_ball": "sim_heavy_ball"}
JOB_FIXTURES = {"j_demo_lecture": "job_events"}
ASK_FIXTURES = {
    "lecture": "ask_spatial_lecture",
    "sim": "ask_spatial_sim",
    "hypothesis": "ask_spatial_hypothesis",
}


def register(reg: Registry) -> None:
    """Nothing to register: the fixtures need no tools, policies or extractors."""


@router.get("/graphs/{graph_id}", response_model=Graph)
def get_graph(graph_id: str, settings: Settings = Depends(get_settings)) -> Graph:
    if graph_id not in GRAPH_FIXTURES:
        raise NotFound(f"Unknown graph {graph_id}", details={"known": sorted(GRAPH_FIXTURES)})
    return load_fixture(GRAPH_FIXTURES[graph_id], Graph, fixtures_dir=settings.fixtures_dir)


@router.get("/sim/{sim_id}", response_model=SimPayload)
def get_sim(sim_id: str, settings: Settings = Depends(get_settings)) -> SimPayload:
    if sim_id not in SIM_FIXTURES:
        raise NotFound(f"Unknown simulation {sim_id}", details={"known": sorted(SIM_FIXTURES)})
    return load_fixture(SIM_FIXTURES[sim_id], SimPayload, fixtures_dir=settings.fixtures_dir)


def _sse(event: JobEvent) -> str:
    return f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"


@router.get("/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    last_event_id: int | None = Query(default=None, description="Resume after this seq"),
    delay_ms: int = Query(default=0, ge=0, le=5000, description="Pause between replayed events"),
    last_event_id_header: str | None = Header(default=None, alias="Last-Event-ID"),
    settings: Settings = Depends(get_settings),
    jobs: JobRunner = Depends(get_jobs),
) -> StreamingResponse:
    after = last_event_id
    if after is None and last_event_id_header is not None and last_event_id_header.isdigit():
        after = int(last_event_id_header)
    after = -1 if after is None else after

    if job_id in JOB_FIXTURES:
        events = load_fixture(
            JOB_FIXTURES[job_id], list[JobEvent], fixtures_dir=settings.fixtures_dir
        )

        async def replay() -> AsyncIterator[str]:
            for event in events:
                if event.seq <= after:
                    continue
                if delay_ms:
                    await asyncio.sleep(delay_ms / 1000)
                yield _sse(event)

        stream: AsyncIterator[str] = replay()
    else:
        try:
            live = jobs.subscribe(job_id, after)
        except JobNotFound:
            raise NotFound(
                f"Unknown job {job_id}", details={"known_demo_jobs": sorted(JOB_FIXTURES)}
            ) from None

        async def follow() -> AsyncIterator[str]:
            async for event in live:
                yield _sse(event)

        stream = follow()

    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/ask-spatial/v2", response_model=AskSpatialResponse)
def ask_spatial_v2(
    req: AskSpatialRequest, settings: Settings = Depends(get_settings)
) -> AskSpatialResponse:
    name = ASK_FIXTURES[req.active_context.view]
    return load_fixture(name, AskSpatialResponse, fixtures_dir=settings.fixtures_dir)
