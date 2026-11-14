"""Extractor interface (guide §4 Phase 2.0 "LLM layer") and its registry.

Only the extraction tasks may be served by a fine-tuned model; everything else always uses
the frontier model. Implementations return the same schema types and register themselves:

    def register(reg):  # in a module's __init__.py
        reg.extractors.register("frontier", lambda ctx: FrontierExtractor(ctx.llm, ctx.settings))

Track A defines `SourceDoc`, `Paper`, `Claim` (`schemas/claims.py`, WP A1); until then they
are `Any` here. Replace the aliases with real imports when A1 lands.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from app.core.errors import ExtractorUnavailable
from app.schemas.graph import Edge, Graph

if TYPE_CHECKING:
    from app.llm.client import LLMClient
    from app.settings import Settings
    from app.tools.broker import Broker

SourceDoc = Any  # TODO(A1): app.schemas.claims.SourceDoc
Paper = Any  # TODO(A1): app.schemas.claims.Paper
Claim = Any  # TODO(A1): app.schemas.claims.Claim


@runtime_checkable
class Extractor(Protocol):
    async def lecture_graph(self, doc: SourceDoc) -> Graph: ...

    async def paper_claims(self, paper: Paper) -> list[Claim]: ...

    async def compare_claims(self, cluster: list[Claim]) -> list[Edge]: ...


@dataclass
class ExtractorContext:
    """What an extractor factory may depend on."""

    settings: Settings
    llm: LLMClient
    broker: Broker


ExtractorFactory = Callable[[ExtractorContext], Extractor]


class ExtractorRegistry:
    """Name -> factory ("frontier", "finetuned", ...)."""

    def __init__(self) -> None:
        self._factories: dict[str, ExtractorFactory] = {}
        self._placeholders: set[str] = set()

    def register(
        self, name: str, factory: ExtractorFactory, *, placeholder: bool = False
    ) -> None:
        """Register a factory. A real registration silently replaces a placeholder (the fake
        the app installs by default); registering the same real name twice is an error."""
        if name in self._factories and name not in self._placeholders:
            raise ValueError(f"extractor {name!r} is already registered")
        self._factories[name] = factory
        if placeholder:
            self._placeholders.add(name)
        else:
            self._placeholders.discard(name)

    def names(self) -> list[str]:
        return sorted(self._factories)

    def is_placeholder(self, name: str) -> bool:
        return name in self._placeholders

    def create(self, name: str, ctx: ExtractorContext) -> Extractor:
        try:
            factory = self._factories[name]
        except KeyError:
            raise ExtractorUnavailable(
                f"Extractor {name!r} is not registered",
                details={"available": self.names()},
            ) from None
        return factory(ctx)
