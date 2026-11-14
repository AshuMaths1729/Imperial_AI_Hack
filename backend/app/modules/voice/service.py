"""ElevenLabs TTS/STT and Anam session-token services (HTTP client is always injected)."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.errors import AppError, OfflineCacheMiss, UpstreamError
from app.settings import Settings

log = logging.getLogger(__name__)

ELEVEN_BASE = "https://api.elevenlabs.io"
DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
TTS_MODEL_ID = "eleven_flash_v2_5"
STT_MODEL_ID = "scribe_v1"
MAX_TTS_CHARS = 1000
MAX_AUDIO_BYTES = 25 * 1024 * 1024
TTS_CONCURRENCY = 4

VOICE_ID_RE = r"^[A-Za-z0-9_-]{1,64}$"
MEDIA_ID_RE = re.compile(r"^[0-9a-f]{16}$")
MEDIA_URL_PREFIX = "/api/media"

ANAM_SESSION_URL = "https://api.anam.ai/v1/auth/session-token"
# Anam persona for the avatar. `llmId` CUSTOMER_CLIENT_V1 disables Anam's own LLM: the
# backend (Claude) decides what to say and the client makes the avatar speak it. The avatar
# and voice ids are Anam stock ids from their quickstart (override via env if they change).
ANAM_PERSONA_CONFIG: dict[str, Any] = {
    "name": "ScholarTwin",
    "avatarId": os.environ.get("ANAM_AVATAR_ID", "30fa96d0-26c4-4e55-94a0-517025942e18"),
    "voiceId": os.environ.get("ANAM_VOICE_ID", "6bfbe25a-979d-40f3-a92b-5394170af54b"),
    "llmId": "CUSTOMER_CLIENT_V1",
    "systemPrompt": "You are ScholarTwin, a concise, friendly tutor. Speak only what you are given.",  # noqa: E501
}


class VoiceUnavailable(AppError):
    """Voice service cannot run (no key / offline); the frontend should fall back."""

    code = "voice_unavailable"
    status_code = 503


class InvalidText(AppError):
    code = "invalid_input"
    status_code = 422


@dataclass(frozen=True)
class TtsResult:
    media_id: str
    path: Path
    cached: bool

    @property
    def url(self) -> str:
        return f"{MEDIA_URL_PREFIX}/{self.media_id}"


def media_dir(settings: Settings) -> Path:
    return settings.state_dir / "media"


def media_id_for(text: str, voice_id: str, model_id: str = TTS_MODEL_ID) -> str:
    return hashlib.sha256((text + voice_id + model_id).encode("utf-8")).hexdigest()[:16]


def media_path(settings: Settings, media_id: str) -> Path | None:
    """Path of a cached mp3, or None if the id is malformed or the file does not exist."""
    if not MEDIA_ID_RE.fullmatch(media_id):
        return None
    path = media_dir(settings) / f"{media_id}.mp3"
    return path if path.is_file() else None


def _api_key(settings: Settings, which: str = "elevenlabs_api_key") -> str | None:
    secret = getattr(settings, which)
    value = secret.get_secret_value().strip() if secret is not None else ""
    return value or None


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{id(data)}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


async def synthesize(
    settings: Settings,
    client: httpx.AsyncClient,
    text: str,
    voice_id: str | None = None,
) -> TtsResult:
    """Text -> cached mp3. Runtime routes and `scripts/pregen_audio.py` both go through here
    so the cache keys always match."""
    text = text.strip()
    if not text:
        raise InvalidText("text must not be empty")
    if len(text) > MAX_TTS_CHARS:
        raise InvalidText(f"text is longer than {MAX_TTS_CHARS} characters")
    voice_id = voice_id or DEFAULT_VOICE_ID
    if not re.fullmatch(VOICE_ID_RE, voice_id):
        raise InvalidText("invalid voice_id")

    media_id = media_id_for(text, voice_id)
    path = media_dir(settings) / f"{media_id}.mp3"
    if path.is_file():
        return TtsResult(media_id, path, cached=True)

    if settings.is_offline:
        raise OfflineCacheMiss(
            "Audio is not cached and CACHE_MODE=offline", details={"media_id": media_id}
        )
    key = _api_key(settings)
    if key is None:
        raise VoiceUnavailable("ELEVENLABS_API_KEY is not set; TTS is unavailable")

    try:
        resp = await client.post(
            f"{ELEVEN_BASE}/v1/text-to-speech/{voice_id}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": key, "accept": "audio/mpeg"},
            json={"text": text, "model_id": TTS_MODEL_ID},
        )
    except httpx.HTTPError as exc:
        raise UpstreamError(f"ElevenLabs TTS request failed ({type(exc).__name__})") from exc
    if resp.status_code != 200 or not resp.content:
        raise UpstreamError(f"ElevenLabs TTS failed (HTTP {resp.status_code})")

    await asyncio.to_thread(_write_atomic, path, resp.content)
    return TtsResult(media_id, path, cached=False)


async def synthesize_many(
    settings: Settings,
    client: httpx.AsyncClient,
    texts: list[str],
    voice_id: str | None = None,
) -> list[TtsResult]:
    sem = asyncio.Semaphore(TTS_CONCURRENCY)

    async def one(text: str) -> TtsResult:
        async with sem:
            return await synthesize(settings, client, text, voice_id)

    return list(await asyncio.gather(*(one(t) for t in texts)))


async def transcribe(
    settings: Settings,
    client: httpx.AsyncClient,
    audio: bytes,
    filename: str = "audio.webm",
    content_type: str = "application/octet-stream",
) -> str:
    key = _api_key(settings)
    if key is None:
        raise VoiceUnavailable(
            "ELEVENLABS_API_KEY is not set; use the browser speech recognition instead"
        )
    if settings.is_offline:
        raise VoiceUnavailable(
            "Speech-to-text needs the network (CACHE_MODE=offline); use the browser speech "
            "recognition instead"
        )
    try:
        resp = await client.post(
            f"{ELEVEN_BASE}/v1/speech-to-text",
            headers={"xi-api-key": key},
            files={"file": (filename, audio, content_type)},
            data={"model_id": STT_MODEL_ID},
        )
    except httpx.HTTPError as exc:
        raise UpstreamError(f"ElevenLabs STT request failed ({type(exc).__name__})") from exc
    if resp.status_code != 200:
        raise UpstreamError(f"ElevenLabs STT failed (HTTP {resp.status_code})")
    try:
        text = resp.json().get("text", "")
    except (ValueError, AttributeError) as exc:
        raise UpstreamError("ElevenLabs STT returned an unexpected body") from exc
    return str(text).strip()


@dataclass(frozen=True)
class AvatarSession:
    mode: str  # "avatar" | "audio_only"
    session_token: str | None = None
    expires_at: str | None = None


async def create_avatar_session(settings: Settings, client: httpx.AsyncClient) -> AvatarSession:
    """Anam session token, or `audio_only` when there is no key / offline / Anam fails.
    The key and the token are never logged or cached."""
    key = _api_key(settings, "anam_api_key")
    if key is None or settings.is_offline:
        return AvatarSession("audio_only")
    try:
        resp = await client.post(
            ANAM_SESSION_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"personaConfig": ANAM_PERSONA_CONFIG},
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        log.warning("anam session request failed (%s)", type(exc).__name__)
        return AvatarSession("audio_only")
    if resp.status_code not in (200, 201):
        log.warning("anam session request failed (HTTP %s)", resp.status_code)
        return AvatarSession("audio_only")
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}
    token = body.get("sessionToken") or body.get("session_token") or body.get("token")
    if not isinstance(token, str) or not token:
        log.warning("anam session response had no token (HTTP %s)", resp.status_code)
        return AvatarSession("audio_only")
    expires = body.get("expiresAt") or body.get("expires_at")
    return AvatarSession("avatar", token, str(expires) if expires else None)
