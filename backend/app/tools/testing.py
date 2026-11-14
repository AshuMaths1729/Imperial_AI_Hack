"""FakeBroker: replays recorded results and records every call. For tests and fixture mode.

Results can be given as a dict and/or a fixture directory. Lookup order for a call:
  1. exact key  `"<tool>:<sha16 of canonical args>"`  (see `FakeBroker.key`)
  2. `"<tool>"`     (any args)
For `http` calls the keys are `"<tool>:<METHOD> <url>"` then `"<tool>"`.
A value may be a plain result, a `list` wrapped in `Queue([...])` (popped one per call), or a
callable `(args) -> result`. In a fixture dir, `<tool>.json` is the any-args result and
`<tool>/<sha16>.json` the exact-args result.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from app.core.errors import OfflineCacheMiss
from app.tools.broker import HttpResult

T = TypeVar("T")


@dataclass
class Queue:
    """Results served one per call, in order."""

    items: list[Any]


@dataclass
class RecordedCall:
    route: str
    tool: str
    kind: str  # "call" | "http"
    args: Any


def canonical_args(args: Any) -> str:
    return json.dumps(args, sort_keys=True, separators=(",", ":"), default=str)


class FakeBroker:
    def __init__(
        self,
        results: Mapping[str, Any] | None = None,
        fixture_dir: Path | None = None,
        *,
        strict: bool = True,
    ) -> None:
        self.results: dict[str, Any] = dict(results or {})
        self.fixture_dir = fixture_dir
        self.strict = strict  # strict: a call with no recorded result raises OfflineCacheMiss
        self.calls: list[RecordedCall] = []

    @staticmethod
    def key(tool: str, args: Any) -> str:
        digest = hashlib.sha256(canonical_args(args).encode()).hexdigest()[:16]
        return f"{tool}:{digest}"

    def for_route(self, route: str) -> _FakeRouteBroker:
        return _FakeRouteBroker(self, route)

    def calls_to(self, tool: str) -> list[RecordedCall]:
        return [c for c in self.calls if c.tool == tool]

    # -- lookup
    def _lookup(self, keys: list[str], tool: str, args: Any) -> tuple[bool, Any]:
        for k in keys:
            if k in self.results:
                return True, self._resolve(self.results[k], args)
        if self.fixture_dir is not None:
            for path in (
                self.fixture_dir / tool / f"{self.key(tool, args).split(':', 1)[1]}.json",
                self.fixture_dir / f"{tool}.json",
            ):
                if path.exists():
                    return True, json.loads(path.read_text(encoding="utf-8"))
        return False, None

    @staticmethod
    def _resolve(value: Any, args: Any) -> Any:
        if isinstance(value, Queue):
            if not value.items:
                raise OfflineCacheMiss("FakeBroker queue exhausted")
            return value.items.pop(0)
        if callable(value):
            return value(args)
        return value


class _FakeRouteBroker:
    def __init__(self, parent: FakeBroker, route: str) -> None:
        self._p = parent
        self.route = route

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
        self._p.calls.append(RecordedCall(self.route, tool, "call", dict(args)))
        found, value = self._p._lookup([FakeBroker.key(tool, dict(args)), tool], tool, dict(args))
        if not found:
            if self._p.strict:
                raise OfflineCacheMiss(
                    f"FakeBroker has no recorded result for {tool!r}",
                    details={"route": self.route, "tool": tool},
                )
            return await fn()
        if (
            result_type is not None
            and isinstance(result_type, type)
            and issubclass(result_type, BaseModel)
            and not isinstance(value, result_type)
        ):
            return result_type.model_validate(value)  # type: ignore[return-value]
        return value

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
        args = {"method": method, "url": url, "json": json, "params": dict(params or {})}
        self._p.calls.append(RecordedCall(self.route, tool, "http", args))
        found, value = self._p._lookup([f"{tool}:{method.upper()} {url}", tool], tool, args)
        if not found and self._p.strict:
            raise OfflineCacheMiss(
                f"FakeBroker has no recorded result for {tool!r} {method} {url}",
                details={"route": self.route, "tool": tool},
            )
        return value
