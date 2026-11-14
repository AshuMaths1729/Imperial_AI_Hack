from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.errors import NotFound
from app.deps import get_settings
from app.modules.voice import service
from app.settings import Settings

router = APIRouter(tags=["voice"])


async def get_voice_http() -> AsyncIterator[httpx.AsyncClient]:
    """Injectable HTTP client (tests override this with a MockTransport client)."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        yield client


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=service.MAX_TTS_CHARS)
    voice_id: str | None = Field(default=None, pattern=service.VOICE_ID_RE)


class TtsResponse(BaseModel):
    media_id: str
    url: str
    cached: bool


class TtsSegmentIn(BaseModel):
    text: str = Field(min_length=1, max_length=service.MAX_TTS_CHARS)


class TtsSegmentsRequest(BaseModel):
    segments: list[TtsSegmentIn] = Field(min_length=1, max_length=50)
    voice_id: str | None = Field(default=None, pattern=service.VOICE_ID_RE)


class SttResponse(BaseModel):
    transcript: str


def _tts_response(result: service.TtsResult) -> TtsResponse:
    return TtsResponse(media_id=result.media_id, url=result.url, cached=result.cached)


@router.post("/tts", response_model=TtsResponse)
async def tts(
    body: TtsRequest,
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_voice_http),
) -> TtsResponse:
    return _tts_response(await service.synthesize(settings, client, body.text, body.voice_id))


@router.post("/tts/segments", response_model=list[TtsResponse])
async def tts_segments(
    body: TtsSegmentsRequest,
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_voice_http),
) -> list[TtsResponse]:
    results = await service.synthesize_many(
        settings, client, [s.text for s in body.segments], body.voice_id
    )
    return [_tts_response(r) for r in results]


@router.get("/media/{media_id}")
async def media(media_id: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    path = service.media_path(settings, media_id)
    if path is None:
        raise NotFound(f"No cached audio {media_id!r}")
    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.post("/stt", response_model=SttResponse)
async def stt(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_voice_http),
) -> SttResponse:
    audio = await file.read(service.MAX_AUDIO_BYTES + 1)
    if len(audio) > service.MAX_AUDIO_BYTES:
        raise service.InvalidText("audio file is too large (max 25 MB)")
    if not audio:
        raise service.InvalidText("audio file is empty")
    transcript = await service.transcribe(
        settings,
        client,
        audio,
        filename=file.filename or "audio.webm",
        content_type=file.content_type or "application/octet-stream",
    )
    return SttResponse(transcript=transcript)
