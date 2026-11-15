"""FastAPI dependency providers. Routers depend on these, never on concrete classes.

    @router.post("/x")
    async def x(jobs: JobRunner = Depends(get_jobs), broker: Broker = Depends(get_broker)): ...

Tests can swap an implementation:
`app.dependency_overrides[get_broker] = lambda: FakeBroker(...)`.
"""

from __future__ import annotations

from fastapi import Depends, Query, Request

from app.container import Container
from app.core.cache import CacheStore
from app.core.jobs import JobRunner
from app.llm.client import LLMClient
from app.llm.extractor import Extractor, ExtractorContext
from app.settings import Settings
from app.tools.broker import Broker


def get_container(request: Request) -> Container:
    return request.app.state.container


def get_settings(c: Container = Depends(get_container)) -> Settings:
    return c.settings


def get_cache(c: Container = Depends(get_container)) -> CacheStore:
    return c.cache


def get_jobs(c: Container = Depends(get_container)) -> JobRunner:
    return c.jobs


def get_broker(c: Container = Depends(get_container)) -> Broker:
    return c.broker


def get_llm(c: Container = Depends(get_container)) -> LLMClient:
    return c.llm


def get_extractor(
    c: Container = Depends(get_container),
    extractor: str | None = Query(
        default=None,
        description="Override EXTRACTOR_BACKEND for this request (frontier | finetuned)",
    ),
) -> Extractor:
    name = extractor or c.settings.extractor_backend
    return c.registry.extractors.create(
        name, ExtractorContext(settings=c.settings, llm=c.llm, broker=c.broker)
    )
