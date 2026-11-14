"""LLMClient: every model call goes through this interface (C3 implements the Claude client).

Rules the real client follows (so callers don't have to): structured outputs via the Pydantic
`output` type (no forced `tool_choice`, no prefill); per-route model/effort from settings;
refusal -> `LLMRefusal`; `max_tokens` -> one retry then `LLMTruncated`; validation failure ->
one retry with the error, then `SchemaValidationError`; every call goes through the broker so
it is cached and replayable offline.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Generic, Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel

T = TypeVar("T")
M = TypeVar("M", bound=BaseModel)

# A string, or a list of Anthropic content blocks (text / image / document dicts).
Content = str | Sequence[Mapping[str, Any]]


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0


@dataclass
class LLMResult(Generic[T]):
    output: T
    model: str = ""
    stop_reason: str | None = None
    usage: Usage = field(default_factory=Usage)
    cost_usd: float | None = None
    cached: bool = False  # served from the cache, not a live call


@dataclass(frozen=True)
class ParseRequest:
    """One item of a `batch_parse`."""

    prompt: str
    content: Content = ""
    prompt_version: str = ""


@runtime_checkable
class LLMClient(Protocol):
    async def parse(
        self,
        route: str,
        prompt: str,
        content: Content,
        output: type[M],
        *,
        prompt_version: str = "",
        max_tokens: int | None = None,
    ) -> LLMResult[M]:
        """One structured-output call: `output` is the Pydantic model the reply must match."""
        ...

    async def agent(
        self,
        route: str,
        prompt: str,
        *,
        content: Content = "",
        tools: Sequence[str] = (),
        mcp: Sequence[str] = (),
        output: type[M] | None = None,
        prompt_version: str = "",
    ) -> LLMResult[Any]:
        """A tool-using loop (Tool Runner). `tools` are `ToolDef` names from the registry,
        `mcp` are MCP server names; both are further limited by the route's `RoutePolicy`.
        Returns a validated `output` instance, or the final text if `output` is None."""
        ...

    async def batch_parse(
        self,
        route: str,
        requests: Sequence[ParseRequest],
        output: type[M],
    ) -> list[LLMResult[M]]:
        """Many `parse` calls at half price (Message Batches). Results are in request order
        and are cached under the same keys single `parse` calls would use."""
        ...
