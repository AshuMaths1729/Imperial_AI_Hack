"""CacheStore: where every external result lives (swap point: filesystem -> Redis/S3).

Hackathon implementation (C1): content-addressed JSON/blob files under `cache/`, plus a
layered store that reads a read-only Demo Preset first. WP0 ships the interface and an
in-memory implementation so lanes can start immediately.

Namespaces (`ns`) separate kinds of entries (e.g. "llm", "tool", "tts"); keys are opaque
strings, usually a sha256 of (tool, args, prompt_version, model). Values are JSON dicts.
Artifacts are typed Pydantic results of pipeline stages, stored under (kind, id) so a job
can resume.

All methods are async so a networked store can replace the in-memory one without changing
callers.
"""

from __future__ import annotations

import copy
from typing import Any, Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


@runtime_checkable
class CacheStore(Protocol):
    async def get(self, ns: str, key: str) -> dict[str, Any] | None: ...

    async def put(self, ns: str, key: str, value: dict[str, Any]) -> None: ...

    async def put_blob(self, ns: str, key: str, data: bytes) -> None: ...

    async def get_blob(self, ns: str, key: str) -> bytes | None: ...

    async def put_artifact(self, kind: str, id: str, model: BaseModel) -> None: ...

    async def get_artifact(self, kind: str, id: str, type_: type[T]) -> T | None: ...


class MemoryCacheStore:
    """Process-local store. Values are deep-copied in and out so callers cannot mutate it."""

    def __init__(self) -> None:
        self._json: dict[tuple[str, str], dict[str, Any]] = {}
        self._blobs: dict[tuple[str, str], bytes] = {}
        self._artifacts: dict[tuple[str, str], dict[str, Any]] = {}

    async def get(self, ns: str, key: str) -> dict[str, Any] | None:
        value = self._json.get((ns, key))
        return copy.deepcopy(value) if value is not None else None

    async def put(self, ns: str, key: str, value: dict[str, Any]) -> None:
        self._json[(ns, key)] = copy.deepcopy(value)

    async def put_blob(self, ns: str, key: str, data: bytes) -> None:
        self._blobs[(ns, key)] = bytes(data)

    async def get_blob(self, ns: str, key: str) -> bytes | None:
        return self._blobs.get((ns, key))

    async def put_artifact(self, kind: str, id: str, model: BaseModel) -> None:
        self._artifacts[(kind, id)] = model.model_dump(mode="json")

    async def get_artifact(self, kind: str, id: str, type_: type[T]) -> T | None:
        raw = self._artifacts.get((kind, id))
        return type_.model_validate(raw) if raw is not None else None
