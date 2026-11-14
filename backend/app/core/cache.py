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

import asyncio
import contextlib
import copy
import json
import os
import re
import tempfile
from pathlib import Path
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


_SAFE = re.compile(r"[^A-Za-z0-9._-]")


def _safe(part: str) -> str:
    """One path component: unsafe characters are replaced, so a key can never escape the dir."""
    cleaned = _SAFE.sub("_", part).strip(".") or "_"
    return cleaned[:200]


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=path.suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


def _read_bytes(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


class FileCacheStore:
    """JSON / blob files under `root` (`<root>/<ns>/<key>.json`, `.bin`; artifacts under
    `<root>/artifacts/<kind>/<id>.json`). Writes are atomic (temp file + rename), so a crash
    never leaves a half-written entry; unreadable entries count as misses."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _path(self, ns: str, key: str, suffix: str) -> Path:
        return self.root / _safe(ns) / f"{_safe(key)}{suffix}"

    def _artifact_path(self, kind: str, id: str) -> Path:
        return self.root / "artifacts" / _safe(kind) / f"{_safe(id)}.json"

    @staticmethod
    def _decode(raw: bytes | None) -> dict[str, Any] | None:
        if raw is None:
            return None
        try:
            value = json.loads(raw)
        except ValueError:
            return None
        return value if isinstance(value, dict) else None

    async def get(self, ns: str, key: str) -> dict[str, Any] | None:
        return self._decode(await asyncio.to_thread(_read_bytes, self._path(ns, key, ".json")))

    async def put(self, ns: str, key: str, value: dict[str, Any]) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        await asyncio.to_thread(_atomic_write, self._path(ns, key, ".json"), data)

    async def put_blob(self, ns: str, key: str, data: bytes) -> None:
        await asyncio.to_thread(_atomic_write, self._path(ns, key, ".bin"), bytes(data))

    async def get_blob(self, ns: str, key: str) -> bytes | None:
        return await asyncio.to_thread(_read_bytes, self._path(ns, key, ".bin"))

    async def put_artifact(self, kind: str, id: str, model: BaseModel) -> None:
        data = model.model_dump_json().encode("utf-8")
        await asyncio.to_thread(_atomic_write, self._artifact_path(kind, id), data)

    async def get_artifact(self, kind: str, id: str, type_: type[T]) -> T | None:
        raw = self._decode(await asyncio.to_thread(_read_bytes, self._artifact_path(kind, id)))
        if raw is None:
            return None
        try:
            return type_.model_validate(raw)
        except ValueError:
            return None
