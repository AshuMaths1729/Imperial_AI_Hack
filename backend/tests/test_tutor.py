"""Tutor lane tests: token claims are decoded locally, no LiveKit server is contacted."""

from __future__ import annotations

import json

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

LK_SECRET = "test-secret-at-least-32-characters-long"


@pytest.fixture
def lk_client():
    settings = Settings(
        _env_file=None,
        livekit_url="wss://example.livekit.cloud",
        livekit_api_key="APIkey",
        livekit_api_secret=LK_SECRET,
        tutor_agent_name="tutor-test",
    )
    with TestClient(create_app(settings)) as c:
        yield c


def test_lists_two_tutors_with_distinct_voices(client):
    tutors = client.get("/api/tutor/tutors").json()
    assert len(tutors) == 2
    assert len({t["voice_id"] for t in tutors}) == 2


def test_session_needs_livekit_credentials(client):
    r = client.post("/api/tutor/session", json={"tutor_id": "kenji-visual"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "livekit_unavailable"


def test_unknown_tutor_is_404(lk_client):
    assert lk_client.post("/api/tutor/session", json={"tutor_id": "nobody"}).status_code == 404


def test_session_token_dispatches_agent_with_all_tutors(lk_client):
    r = lk_client.post("/api/tutor/session", json={"tutor_id": "jenny-socratic"})
    assert r.status_code == 200
    body = r.json()
    assert body["url"] == "wss://example.livekit.cloud"
    assert body["identity"].startswith("student-")

    claims = jwt.decode(body["token"], LK_SECRET, algorithms=["HS256"])
    assert claims["sub"] == body["identity"]
    assert claims["video"]["room"] == body["room"]
    (dispatch,) = claims["roomConfig"]["agents"]
    assert dispatch["agentName"] == "tutor-test"
    meta = json.loads(dispatch["metadata"])
    assert meta["tutor_id"] == "jenny-socratic"
    assert [t["tutor_id"] for t in meta["tutors"]] == ["kenji-visual", "jenny-socratic"]


def test_mei_stays_hidden_until_her_avatar_is_set():
    from app.modules.tutor import tutors
    assert all(t.avatar_id for t in tutors.TUTORS)
    assert ("mei-examples" in tutors.BY_ID) == bool(tutors.MEI)
