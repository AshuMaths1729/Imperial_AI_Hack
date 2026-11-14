from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.errors import NotFound
from app.deps import get_settings
from app.modules.synthesia import service
from app.settings import Settings

router = APIRouter(tags=["synthesia"])

AVATAR_PATTERN = r"^[A-Za-z0-9_-]{1,100}$"


async def get_synthesia_http() -> AsyncIterator[httpx.AsyncClient]:
    """Injectable HTTP client (tests override this with a MockTransport client)."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        yield client


class ClipCreateRequest(BaseModel):
    script: str = Field(min_length=1, max_length=service.MAX_SCRIPT_CHARS)
    title: str | None = Field(default=None, max_length=200)
    avatar: str | None = Field(default=None, pattern=AVATAR_PATTERN)


class ClipCreateResponse(BaseModel):
    clip_id: str
    status: str


class ClipLookupRequest(BaseModel):
    script: str = Field(min_length=1, max_length=service.MAX_SCRIPT_CHARS)
    avatar: str | None = Field(default=None, pattern=AVATAR_PATTERN)


class ClipLookupResponse(BaseModel):
    found: bool
    clip_id: str
    status: str | None = None
    ready: bool = False
    video_url: str | None = None


class ClipStatusResponse(BaseModel):
    clip_id: str
    status: str
    ready: bool
    video_url: str | None = None
    script: str
    error: str | None = None


class ClipSummary(BaseModel):
    clip_id: str
    title: str
    status: str
    ready: bool


class AvatarClipSession(BaseModel):
    mode: Literal["clips", "audio_only"]
    ready_clips: int
    can_render: bool


def _status(settings: Settings, rec: dict[str, Any]) -> ClipStatusResponse:
    return ClipStatusResponse(
        clip_id=rec["clip_id"],
        status=rec["status"],
        ready=service.is_ready(settings, rec),
        video_url=service.video_url(settings, rec),
        script=rec.get("script", ""),
        error=rec.get("error"),
    )


@router.post("/avatar/clips", response_model=ClipCreateResponse)
async def create_clip(
    body: ClipCreateRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_synthesia_http),
) -> ClipCreateResponse:
    record, created = await service.create_clip(
        settings, client, body.script, title=body.title, avatar=body.avatar
    )
    response.status_code = 202 if created else 200
    return ClipCreateResponse(clip_id=record["clip_id"], status=record["status"])


@router.post("/avatar/clips/lookup", response_model=ClipLookupResponse)
async def lookup_clip(
    body: ClipLookupRequest, settings: Settings = Depends(get_settings)
) -> ClipLookupResponse:
    clip_id = service.resolve_clip_id(body.script, body.avatar)
    record = service.load_record(settings, clip_id)
    if record is None:
        return ClipLookupResponse(found=False, clip_id=clip_id)
    return ClipLookupResponse(
        found=True,
        clip_id=clip_id,
        status=record["status"],
        ready=service.is_ready(settings, record),
        video_url=service.video_url(settings, record),
    )


@router.get("/avatar/clips", response_model=list[ClipSummary])
async def list_clips(settings: Settings = Depends(get_settings)) -> list[ClipSummary]:
    return [
        ClipSummary(
            clip_id=r["clip_id"],
            title=r.get("title", ""),
            status=r["status"],
            ready=service.is_ready(settings, r),
        )
        for r in service.list_records(settings)
    ]


@router.get("/avatar/clips/{clip_id}", response_model=ClipStatusResponse)
async def get_clip(
    clip_id: str,
    settings: Settings = Depends(get_settings),
    client: httpx.AsyncClient = Depends(get_synthesia_http),
) -> ClipStatusResponse:
    return _status(settings, await service.get_clip(settings, client, clip_id))


@router.get("/avatar/clips/{clip_id}/video")
async def clip_video(clip_id: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    path = service.video_path(settings, clip_id)
    if path is None:
        raise NotFound(f"No rendered avatar clip {clip_id!r}")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.post("/avatar/session", response_model=AvatarClipSession)
async def avatar_session(
    response: Response, settings: Settings = Depends(get_settings)
) -> AvatarClipSession:
    response.headers["Cache-Control"] = "no-store"
    return AvatarClipSession(**service.session_info(settings))
