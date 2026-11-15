from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Response
from livekit import api
from pydantic import BaseModel

from app.core.errors import AppError, NotFound
from app.deps import get_settings
from app.modules.tutor.tutors import BY_ID, TUTORS, Tutor
from app.settings import Settings

router = APIRouter(tags=["tutor"])


class LiveKitUnavailable(AppError):
    code = "livekit_unavailable"
    status_code = 503


class SessionRequest(BaseModel):
    tutor_id: str


class SessionResponse(BaseModel):
    url: str
    token: str
    room: str
    identity: str


@router.get("/tutor/tutors", response_model=list[Tutor])
async def list_tutors() -> list[Tutor]:
    return TUTORS


@router.post("/tutor/session", response_model=SessionResponse)
async def start_session(
    body: SessionRequest, response: Response, settings: Settings = Depends(get_settings)
) -> SessionResponse:
    response.headers["Cache-Control"] = "no-store"
    if body.tutor_id not in BY_ID:
        raise NotFound(f"Unknown tutor {body.tutor_id!r}")
    if not (settings.livekit_url and settings.livekit_api_key and settings.livekit_api_secret):
        raise LiveKitUnavailable("LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set")

    suffix = uuid.uuid4().hex[:8]
    room, identity = f"tutor-{suffix}", f"student-{suffix}"
    metadata = {"tutor_id": body.tutor_id, "tutors": [t.model_dump() for t in TUTORS]}
    token = (
        api.AccessToken(
            settings.livekit_api_key.get_secret_value(),
            settings.livekit_api_secret.get_secret_value(),
        )
        .with_identity(identity)
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .with_room_config(
            api.RoomConfiguration(
                agents=[
                    api.RoomAgentDispatch(
                        agent_name=settings.tutor_agent_name, metadata=json.dumps(metadata)
                    )
                ],
            )
        )
        .to_jwt()
    )
    return SessionResponse(url=settings.livekit_url, token=token, room=room, identity=identity)
