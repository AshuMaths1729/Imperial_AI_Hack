"""Synthesia avatar clips: submit renders, poll on read, cache the MP4s on disk.

Synthesia renders asynchronously (minutes), so clips are pre-rendered for the scripted demo
questions (`scripts/prerender_avatar_clips.py`) and the frontend plays a ready clip, falling
back to ElevenLabs audio (`/api/tts`) for anything unscripted. The HTTP client is always
injected; the API key is read at call time and never logged or returned.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

from app.core.errors import AppError, NotFound, OfflineCacheMiss, UpstreamError
from app.settings import Settings

log = logging.getLogger(__name__)

SYNTHESIA_BASE = "https://api.synthesia.io/v2"
MAX_SCRIPT_CHARS = 3000
CLIP_ID_RE = re.compile(r"^[a-f0-9]{16}$")
VIDEO_URL_PREFIX = "/api/avatar/clips"

# Synthesia v2 has no list-avatars endpoint (GET /v2/avatars is a 404); stock avatar ids come
# from the docs. `anna_costume1_cameraA` is the docs' own example avatar.
AVATAR_ID = os.environ.get("SYNTHESIA_AVATAR_ID", "anna_costume1_cameraA")
BACKGROUND = os.environ.get("SYNTHESIA_BACKGROUND", "off_white")
# Test renders are free but watermarked. Set SYNTHESIA_TEST_MODE=false only for final clips.
TEST_MODE = os.environ.get("SYNTHESIA_TEST_MODE", "true").strip().lower() not in (
    "0",
    "false",
    "no",
    "off",
)

DONE = {"complete", "completed"}
FAILED = {"error", "failed", "rejected", "deleted"}


class SynthesiaUnavailable(AppError):
    code = "synthesia_unavailable"
    status_code = 503


class InvalidScript(AppError):
    code = "invalid_input"
    status_code = 422


def normalize_status(raw: object) -> str:
    """Map any Synthesia status string to complete | error | in_progress."""
    s = str(raw or "").strip().lower()
    if s in DONE:
        return "complete"
    if s in FAILED:
        return "error"
    return "in_progress"


def clip_id_for(script: str, avatar: str, background: str, test: bool) -> str:
    raw = script + avatar + background + str(test)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def clips_dir(settings: Settings) -> Path:
    return settings.state_dir / "clips"


def api_key(settings: Settings) -> str | None:
    secret = settings.synthesia_api_key
    value = secret.get_secret_value().strip() if secret is not None else ""
    return value or None


def _record_path(settings: Settings, clip_id: str) -> Path | None:
    if not CLIP_ID_RE.fullmatch(clip_id):
        return None
    return clips_dir(settings) / f"{clip_id}.json"


def video_path(settings: Settings, clip_id: str) -> Path | None:
    """Path of a downloaded MP4, or None if the id is malformed or the file does not exist."""
    if not CLIP_ID_RE.fullmatch(clip_id):
        return None
    path = clips_dir(settings) / f"{clip_id}.mp4"
    return path if path.is_file() else None


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{id(data)}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def load_record(settings: Settings, clip_id: str) -> dict[str, Any] | None:
    path = _record_path(settings, clip_id)
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def save_record(settings: Settings, record: dict[str, Any]) -> None:
    path = _record_path(settings, record["clip_id"])
    assert path is not None
    _write_atomic(path, json.dumps(record, indent=2).encode("utf-8"))


def is_ready(settings: Settings, record: dict[str, Any]) -> bool:
    return (
        record.get("status") == "complete" and video_path(settings, record["clip_id"]) is not None
    )


def video_url(settings: Settings, record: dict[str, Any]) -> str | None:
    return f"{VIDEO_URL_PREFIX}/{record['clip_id']}/video" if is_ready(settings, record) else None


def list_records(settings: Settings) -> list[dict[str, Any]]:
    records = []
    for path in sorted(clips_dir(settings).glob("*.json")):
        rec = load_record(settings, path.stem)
        if rec is not None:
            records.append(rec)
    records.sort(key=lambda r: r.get("created_at", ""))
    return records


def _clean_script(script: str) -> str:
    script = script.strip()
    if not script:
        raise InvalidScript("script must not be empty")
    if len(script) > MAX_SCRIPT_CHARS:
        raise InvalidScript(f"script is longer than {MAX_SCRIPT_CHARS} characters")
    return script


def resolve_clip_id(
    script: str,
    avatar: str | None = None,
    background: str | None = None,
    test: bool | None = None,
) -> str:
    return clip_id_for(
        _clean_script(script),
        avatar or AVATAR_ID,
        background or BACKGROUND,
        TEST_MODE if test is None else test,
    )


def _upstream_message(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        msg = (body.get("message") or body.get("error")) if isinstance(body, dict) else None
    except ValueError:
        msg = None
    return f" - {str(msg)[:200]}" if msg else ""


async def create_clip(
    settings: Settings,
    client: httpx.AsyncClient,
    script: str,
    *,
    title: str | None = None,
    avatar: str | None = None,
    background: str | None = None,
    test: bool | None = None,
) -> tuple[dict[str, Any], bool]:
    """Submit a render unless one with the same clip_id already exists (errored renders are
    resubmitted). Returns (record, created)."""
    script = _clean_script(script)
    avatar = avatar or AVATAR_ID
    background = background or BACKGROUND
    test = TEST_MODE if test is None else test
    clip_id = clip_id_for(script, avatar, background, test)

    existing = load_record(settings, clip_id)
    if existing is not None and (existing.get("status") != "error" or settings.is_offline):
        return existing, False
    if settings.is_offline:
        raise OfflineCacheMiss(
            "Avatar clip is not cached and CACHE_MODE=offline", details={"clip_id": clip_id}
        )
    key = api_key(settings)
    if key is None:
        raise SynthesiaUnavailable("SYNTHESIA_API_KEY is not set; avatar clips cannot be rendered")

    payload = {
        "test": test,
        "title": (title or script[:60]).strip()[:200],
        "visibility": "private",
        "input": [{"scriptText": script, "avatar": avatar, "background": background}],
    }
    try:
        resp = await client.post(
            f"{SYNTHESIA_BASE}/videos", headers={"Authorization": key}, json=payload
        )
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Synthesia request failed ({type(exc).__name__})") from exc
    if resp.status_code not in (200, 201, 202):
        raise UpstreamError(
            f"Synthesia create failed (HTTP {resp.status_code}){_upstream_message(resp)}"
        )
    try:
        sid = resp.json().get("id")
    except (ValueError, AttributeError):
        sid = None
    if not isinstance(sid, str) or not sid:
        raise UpstreamError("Synthesia create returned no video id")

    record: dict[str, Any] = {
        "clip_id": clip_id,
        "script": script,
        "title": payload["title"],
        "synthesia_id": sid,
        "status": "in_progress",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "test": test,
    }
    await asyncio.to_thread(save_record, settings, record)
    return record, True


async def _download(client: httpx.AsyncClient, url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    try:
        # presigned URL: do not send the Synthesia Authorization header
        async with client.stream("GET", url, follow_redirects=True) as resp:
            if resp.status_code != 200:
                raise UpstreamError(f"Synthesia download failed (HTTP {resp.status_code})")
            with tmp.open("wb") as fh:
                async for chunk in resp.aiter_bytes():
                    fh.write(chunk)
        if tmp.stat().st_size == 0:
            raise UpstreamError("Synthesia download was empty")
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


async def refresh_clip(
    settings: Settings, client: httpx.AsyncClient, record: dict[str, Any]
) -> dict[str, Any]:
    """Poll Synthesia while the render is in progress and download the MP4 once complete.
    Skips the network when the record is final, we are offline, or there is no key. Transient
    upstream failures leave the record unchanged (the next read retries)."""
    if record.get("status") != "in_progress" or settings.is_offline:
        return record
    key = api_key(settings)
    if key is None or not record.get("synthesia_id"):
        return record
    try:
        resp = await client.get(
            f"{SYNTHESIA_BASE}/videos/{record['synthesia_id']}", headers={"Authorization": key}
        )
    except httpx.HTTPError as exc:
        log.warning("synthesia status poll failed (%s)", type(exc).__name__)
        return record

    record = dict(record)
    if resp.status_code == 404:
        record.update(status="error", error="Synthesia video not found (deleted?)")
    elif resp.status_code != 200:
        log.warning("synthesia status poll failed (HTTP %s)", resp.status_code)
        return record
    else:
        try:
            body = resp.json()
        except ValueError:
            return record
        raw = body.get("status") if isinstance(body, dict) else None
        status = normalize_status(raw)
        if status == "error":
            record.update(status="error", error=f"Synthesia render ended with status {raw!r}")
        elif status == "complete":
            url = body.get("download")
            if not isinstance(url, str) or not url:
                return record  # complete but no link yet: try again on the next read
            try:
                await _download(client, url, clips_dir(settings) / f"{record['clip_id']}.mp4")
            except (httpx.HTTPError, UpstreamError, OSError) as exc:
                log.warning("synthesia download failed (%s)", type(exc).__name__)
                return record
            record["status"] = "complete"
            record.pop("error", None)
        else:
            return record
    await asyncio.to_thread(save_record, settings, record)
    return record


async def get_clip(settings: Settings, client: httpx.AsyncClient, clip_id: str) -> dict[str, Any]:
    record = load_record(settings, clip_id)
    if record is None:
        raise NotFound(f"No avatar clip {clip_id!r}")
    return await refresh_clip(settings, client, record)


def session_info(settings: Settings) -> dict[str, Any]:
    ready = sum(1 for r in list_records(settings) if is_ready(settings, r))
    has_key = api_key(settings) is not None
    return {
        "mode": "clips" if (has_key or ready > 0) else "audio_only",
        "ready_clips": ready,
        "can_render": has_key and not settings.is_offline,
    }
