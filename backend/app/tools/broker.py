"""The broker: every external call (LLM, HTTP, MCP, sandbox) goes through it.

C2 implements the real one (content-addressed cache, `CACHE_MODE`, allow-lists, budgets,
ledger). WP0 defines the interface plus `PassthroughBroker`, a placeholder that only
enforces allow-lists and refuses to go live in offline mode, so modules can be written
against the final call shape now. Test with `app.tools.testing.FakeBroker`.

Call shape::

    rb = broker.for_route("hypothesis.fetch")
    papers = await rb.call(
        "search_papers",
        {"query": q},          # args: canonical, JSON-able; part of the cache key
        lambda: s2.search(q),  # fn: zero-arg async thunk, awaited only on a cache miss
        result_type=PaperList,
    )
    meta = await rb.http("s2.paper", "GET", url, params={"fields": "title"})
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any, Literal, Protocol, TypeVar, runtime_checkable

import httpx
from pydantic import BaseModel

from app.core.errors import OfflineCacheMiss, ToolNotAllowed
from app.settings import Settings
from app.tools.registry import Registry

T = TypeVar("T")

HttpResult = Literal["json", "text", "bytes"]


@runtime_checkable
class RouteBroker(Protocol):
    route: str

    async def call(
        self,
        tool: str,
        args: Mapping[str, Any],
        fn: Callable[[], Awaitable[T]],
        *,
        result_type: type[T] | None = None,
        prompt_version: str = "",
        model: str = "",
        timeout: float | None = None,
        cacheable: bool = True,
    ) -> T:
        """Run `fn` (or serve a cached result) for `tool` with `args`.

        The cache key is sha256(tool + canonical args + prompt_version + model). `result_type`
        (a Pydantic model) is used to rebuild the value from the cache.
        """
        ...

    async def http(
        self,
        tool: str,
        method: str,
        url: str,
        *,
        json: Any = None,
        params: Mapping[str, Any] | None = None,
        as_: HttpResult = "json",
    ) -> Any:
        """A cached, budgeted HTTP request (`tool` names the client for allow-lists/logs)."""
        ...


@runtime_checkable
class Broker(Protocol):
    def for_route(self, route: str) -> RouteBroker: ...


class _PassthroughRouteBroker:
    def __init__(self, route: str, registry: Registry, settings: Settings) -> None:
        self.route = route
        self._registry = registry
        self._settings = settings

    def _check(self, tool: str) -> None:
        policy = self._registry.policies.get(self.route)
        if policy is not None and tool not in policy.allowed_tools:
            raise ToolNotAllowed(
                f"Route {self.route!r} may not call {tool!r}",
                details={"route": self.route, "tool": tool},
            )
        if self._settings.is_offline:
            raise OfflineCacheMiss(
                f"{tool}: offline mode and no cache layer yet (C2)",
                details={"route": self.route, "tool": tool},
            )

    async def call(
        self,
        tool: str,
        args: Mapping[str, Any],
        fn: Callable[[], Awaitable[T]],
        *,
        result_type: type[T] | None = None,
        prompt_version: str = "",
        model: str = "",
        timeout: float | None = None,
        cacheable: bool = True,
    ) -> T:
        self._check(tool)
        result = await fn()
        if (
            result_type is not None
            and isinstance(result_type, type)
            and issubclass(result_type, BaseModel)
            and isinstance(result, dict)
        ):
            return result_type.model_validate(result)  # type: ignore[return-value]
        return result

    async def http(
        self,
        tool: str,
        method: str,
        url: str,
        *,
        json: Any = None,
        params: Mapping[str, Any] | None = None,
        as_: HttpResult = "json",
    ) -> Any:
        self._check(tool)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(method, url, json=json, params=params)
            resp.raise_for_status()
            if as_ == "json":
                return resp.json()
            return resp.text if as_ == "text" else resp.content


class PassthroughBroker:
    """Placeholder until C2: no cache, no budgets, no ledger."""

    def __init__(self, registry: Registry, settings: Settings) -> None:
        self._registry = registry
        self._settings = settings

    def for_route(self, route: str) -> RouteBroker:
        return _PassthroughRouteBroker(route, self._registry, self._settings)
