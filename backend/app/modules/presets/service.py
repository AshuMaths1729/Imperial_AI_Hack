"""Freeze / load / list Demo Presets (plain file copies, no hashing, no network).

Layout of `settings.presets_dir/<name>/`:

    manifest.json          counts, created_at, sizes
    state/<same layout as settings.state_dir>   (never mastery/, never `_*` marker files)
    cache/<same layout as settings.cache_dir>
    script.json            optional demo script (kept when a preset is re-frozen)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from collections.abc import Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.errors import AppError, NotFound
from app.settings import Settings

NAME_RE = re.compile(r"[a-z0-9_-]{1,64}")
SEGMENT_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
MARKER = "_preset.json"
MANIFEST = "manifest.json"
STATE_EXCLUDE = frozenset({"mastery"})
CORE_COUNTS = ("graphs", "sims", "quizzes", "media", "cache")

# Deliberately simple: byte patterns that mean "an API key / bearer token is in this file".
SECRET_PATTERNS = (
    re.compile(rb"sk-ant-"),
    re.compile(rb"xi-api-key", re.IGNORECASE),
    re.compile(rb"Bearer\s+[A-Za-z0-9._~+/=-]{20,}"),
)


class InvalidPresetName(AppError):
    code = "invalid_preset_name"
    status_code = 400


class PresetExists(AppError):
    code = "preset_exists"
    status_code = 409


class SecretsDetected(AppError):
    code = "secrets_detected"
    status_code = 422


# --------------------------------------------------------------------------- paths


def preset_path(settings: Settings, name: str) -> Path:
    """`presets_dir/<name>`, only for a strictly valid name that resolves directly under it."""
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise InvalidPresetName(
            "preset name must match [a-z0-9_-]+ (max 64 chars)", details={"name": str(name)[:80]}
        )
    root = settings.presets_dir.resolve()
    path = (root / name).resolve()
    if path.parent != root:
        raise InvalidPresetName("preset path escapes presets_dir", details={"name": name})
    return path


def walk_files(root: Path) -> Iterator[Path]:
    """Regular, non-symlink files under `root` (symlinked dirs are not followed)."""
    for dirpath, _dirs, filenames in os.walk(root):
        for f in filenames:
            p = Path(dirpath) / f
            if not p.is_symlink():
                yield p


# --------------------------------------------------------------------------- copying


def _copy_file(src: str | Path, dst: str | Path) -> None:
    # Plain streamed copy: shutil.copyfile goes through the Windows CopyFile API, which is ~20x
    # slower per small file here (Defender scans each one); read/write keeps load well under 1 s.
    with open(src, "rb") as a, open(dst, "wb") as b:
        shutil.copyfileobj(a, b, 1 << 20)


def _copy_many(pairs: Sequence[tuple[str | Path, str | Path]]) -> None:
    if len(pairs) < 16:
        for s, d in pairs:
            _copy_file(s, d)
        return
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(lambda p: _copy_file(*p), pairs))  # list() re-raises worker errors


# --------------------------------------------------------------------------- secrets


def scan_secrets(files: list[Path]) -> list[Path]:
    """Files whose bytes match a secret pattern. Never returns or logs the matched text."""
    hits: list[Path] = []
    for p in files:
        try:
            data = p.read_bytes()
        except OSError:
            continue
        if any(rx.search(data) for rx in SECRET_PATTERNS):
            hits.append(p)
    return hits


# --------------------------------------------------------------------------- marker


def _marker(settings: Settings) -> Path:
    return settings.state_dir / MARKER


def current_preset(settings: Settings) -> str | None:
    try:
        name = json.loads(_marker(settings).read_text(encoding="utf-8")).get("name")
    except (OSError, ValueError, AttributeError):
        return None
    return name if isinstance(name, str) and NAME_RE.fullmatch(name) else None


def unload_preset(settings: Settings) -> None:
    """Clear the marker only; loaded data stays."""
    try:
        _marker(settings).unlink()
    except FileNotFoundError:
        pass


# --------------------------------------------------------------------------- freeze


def _collect_sources(settings: Settings, include: list[str] | None) -> list[tuple[Path, str]]:
    """(source file, path inside the preset dir) for everything that should be frozen."""
    out: list[tuple[Path, str]] = []
    state_dir, cache_dir = settings.state_dir, settings.cache_dir
    cache_resolved = cache_dir.resolve()
    if state_dir.is_dir() and (include is None or any(i != "cache" for i in include)):
        for entry in sorted(os.scandir(state_dir), key=lambda e: e.name):
            if entry.name.startswith(("_", ".")) or entry.name in STATE_EXCLUDE:
                continue
            path = Path(entry.path)
            if entry.is_symlink() or path.resolve() == cache_resolved:
                continue
            if entry.is_dir():
                if include is not None and entry.name not in include:
                    continue
                out.extend(
                    (p, f"state/{p.relative_to(state_dir).as_posix()}") for p in walk_files(path)
                )
            elif include is None:
                out.append((path, f"state/{entry.name}"))
    if cache_dir.is_dir() and (include is None or "cache" in include):
        out.extend(
            (p, f"cache/{p.relative_to(cache_dir).as_posix()}") for p in walk_files(cache_dir)
        )
    return out


def _counts(rel_paths: list[tuple[str, int]]) -> dict[str, int]:
    counts: dict[str, int] = dict.fromkeys(CORE_COUNTS, 0)
    for rel, _size in rel_paths:
        parts = rel.split("/")
        if parts[0] == "cache":
            key = "cache"
        elif len(parts) > 2:  # state/<subdir>/...
            key = parts[1]
        else:
            key = "state_files"
        counts[key] = counts.get(key, 0) + 1
    return counts


def freeze_preset(
    settings: Settings, name: str, include: list[str] | None = None, overwrite: bool = False
) -> dict[str, Any]:
    dest = preset_path(settings, name)
    if include is not None:
        bad = [i for i in include if not SEGMENT_RE.fullmatch(i)]
        if bad:
            raise InvalidPresetName("invalid include entry", details={"include": bad})
    if dest.exists() and not overwrite:
        raise PresetExists(f"preset '{name}' already exists (pass overwrite=true)")

    sources = _collect_sources(settings, include)
    hit_set = set(scan_secrets([p for p, _ in sources]))
    if hit_set:
        raise SecretsDetected(
            "possible API key/token found; freeze aborted (matched text not shown)",
            details={"files": sorted(rel for p, rel in sources if p in hit_set)},
        )

    presets_root = settings.presets_dir.resolve()
    presets_root.mkdir(parents=True, exist_ok=True)
    tmp = presets_root / f".tmp-{name}-{uuid.uuid4().hex[:8]}"
    try:
        tmp.mkdir()
        for d in {(tmp / rel).parent for _, rel in sources}:
            d.mkdir(parents=True, exist_ok=True)
        _copy_many([(src, tmp / rel) for src, rel in sources])
        sizes = [(rel, (tmp / rel).stat().st_size) for _, rel in sources]
        manifest = {
            "name": name,
            "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "include": include,
            "counts": _counts(sizes),
            "files": len(sizes),
            "bytes": sum(s for _, s in sizes),
        }
        (tmp / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        old = None
        if dest.exists():
            script = dest / "script.json"
            if script.is_file():
                _copy_file(script, tmp / "script.json")
            old = presets_root / f".old-{name}-{uuid.uuid4().hex[:8]}"
            dest.rename(old)
        tmp.rename(dest)
        if old is not None:
            shutil.rmtree(old, ignore_errors=True)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
    return manifest


# --------------------------------------------------------------------------- load / list


def load_preset(settings: Settings, name: str) -> dict[str, Any]:
    t0 = time.perf_counter()
    src = preset_path(settings, name)
    if not (src / MANIFEST).is_file():
        raise NotFound(f"preset '{name}' not found")
    pairs: list[tuple[str, Path]] = []
    for sub, target in (("state", settings.state_dir), ("cache", settings.cache_dir)):
        root = src / sub
        if not root.is_dir():
            continue
        for dirpath, _dirs, filenames in os.walk(root):
            rel = os.path.relpath(dirpath, root)
            tdir = target if rel == "." else target / rel
            tdir.mkdir(parents=True, exist_ok=True)
            for f in filenames:
                sp = os.path.join(dirpath, f)
                if os.path.islink(sp) or (sub == "state" and rel == "." and f.startswith("_")):
                    continue
                pairs.append((sp, tdir / f))
    _copy_many(pairs)
    n = len(pairs)
    settings.state_dir.mkdir(parents=True, exist_ok=True)
    _marker(settings).write_text(
        json.dumps(
            {"name": name, "loaded_at": datetime.now(UTC).isoformat(timespec="seconds"), "files": n}
        ),
        encoding="utf-8",
    )
    return {"loaded": name, "files": n, "ms": round((time.perf_counter() - t0) * 1000, 1)}


def list_presets(settings: Settings) -> list[dict[str, Any]]:
    root = settings.presets_dir
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for d in sorted(root.iterdir(), key=lambda p: p.name):
        if d.name.startswith(".") or not d.is_dir() or not NAME_RE.fullmatch(d.name):
            continue
        try:
            m = json.loads((d / MANIFEST).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        counts = m.get("counts") or {}
        out.append(
            {
                "name": d.name,
                "created_at": m.get("created_at"),
                "counts": {**dict.fromkeys(CORE_COUNTS, 0), **counts},
                "files": m.get("files", 0),
                "bytes": m.get("bytes", 0),
                "has_script": (d / "script.json").is_file(),
            }
        )
    return out
