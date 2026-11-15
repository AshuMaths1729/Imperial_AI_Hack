import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from livekit import api

from app.modules.lesson.livekit_token import mint_token
from app.modules.lesson.router import get_store, tutor_router
from app.modules.lesson.store import make_store


def test_token_has_dispatch_and_sync(monkeypatch):
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "s" * 32)
    token = mint_token(room="tutor-L1", identity="student-demo", agent_name="tutor-test",
                       metadata={"lesson_id": "L1"})
    claims = api.TokenVerifier("devkey", "s" * 32).verify(token)
    assert claims.identity == "student-demo"
    assert claims.video.room == "tutor-L1"
    assert claims.room_config.sync_streams is True
    d = claims.room_config.agents[0]
    assert d.agent_name == "tutor-test"
    assert json.loads(d.metadata)["lesson_id"] == "L1"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    store = make_store()
    app = FastAPI()
    app.include_router(tutor_router, prefix="/api")
    app.dependency_overrides[get_store] = lambda: store
    return TestClient(app)


def test_session_503_without_env(client, monkeypatch):
    for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        monkeypatch.delenv(k, raising=False)
    r = client.post("/api/lesson/session", json={"track_id": "gradient-descent", "tutor_id": "kenji-visual"})
    assert r.status_code == 503 and r.json()["detail"] == "LiveKit is not configured"


def test_session_returns_room_token_and_lesson(client, monkeypatch):
    monkeypatch.setenv("LIVEKIT_URL", "wss://x.livekit.cloud")
    monkeypatch.setenv("LIVEKIT_API_KEY", "devkey")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "s" * 32)
    monkeypatch.setenv("TUTOR_AGENT_NAME", "tutor-test")
    r = client.post("/api/lesson/session", json={"track_id": "gradient-descent", "tutor_id": "kenji-visual"})
    body = r.json()
    assert r.status_code == 200 and body["url"] == "wss://x.livekit.cloud"
    assert body["room"] == f"tutor-{body['lesson_id']}"
    claims = api.TokenVerifier("devkey", "s" * 32).verify(body["token"])
    meta = json.loads(claims.room_config.agents[0].metadata)
    assert meta == {"track_id": "gradient-descent", "lesson_id": body["lesson_id"], "tutor_id": "kenji-visual"}
    assert claims.room_config.agents[0].agent_name == "tutor-test"
    assert client.post("/api/lesson/session", json={"track_id": "nope", "tutor_id": "kenji-visual"}).status_code == 404
