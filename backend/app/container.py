"""The application container: the concrete implementation behind every swap point.

SWAP POINTS (one line each):
  * cache  -> C1 replaces `MemoryCacheStore` with the filesystem / layered store
  * jobs   -> C1 hardens `InProcessJobRunner` (later: Arq/Redis)
  * broker -> C2 replaces `PassthroughBroker` with the caching/budgeted broker
  * llm    -> C3 replaces `FakeLLM` with the Claude client
Extractors are not built here: modules register factories in `register(reg)` and
`deps.get_extractor` creates them by name.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.cache import CacheStore, FileCacheStore, MemoryCacheStore
from app.core.jobs import InProcessJobRunner, JobRunner
from app.llm.anthropic_client import AnthropicLLM
from app.llm.client import LLMClient
from app.llm.testing import FakeExtractor, FakeLLM
from app.settings import Settings
from app.tools.broker import Broker, PassthroughBroker
from app.tools.registry import Registry


@dataclass
class Container:
    settings: Settings
    registry: Registry
    cache: CacheStore
    jobs: JobRunner
    broker: Broker
    llm: LLMClient


def register_defaults(registry: Registry) -> None:
    """Placeholders that real registrations (modules' `register`) replace."""
    registry.extractors.register("frontier", lambda ctx: FakeExtractor(), placeholder=True)


def build_container(settings: Settings, registry: Registry) -> Container:
    cache: CacheStore
    llm: LLMClient
    if settings.anthropic_api_key is not None:
        # real Claude client; results are cached on disk so a recorded run replays offline
        cache = FileCacheStore(settings.cache_dir)
        llm = AnthropicLLM(settings, cache)
    else:
        cache = MemoryCacheStore()
        llm = FakeLLM(fixture_dir=settings.fixtures_dir / "llm")
    return Container(
        settings=settings,
        registry=registry,
        cache=cache,
        jobs=InProcessJobRunner(),
        broker=PassthroughBroker(registry, settings),
        llm=llm,
    )
