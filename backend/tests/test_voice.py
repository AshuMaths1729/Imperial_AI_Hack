"""Voice lane tests: no live calls (ElevenLabs is replaced by httpx.MockTransport)."""

from __future__ import annotations

import asyncio
import importlib.util
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.voice import service
from app.modules.voice.router import get_voice_http
from app.settings import Settings

ELEVEN_KEY = "sk_test_ELEVEN_SECRET_123"
FAKE_MP3 = b"ID3" + b"\x00" * 2048


class Upstream:
    """Records every request and answers like ElevenLabs."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.active = 0
        self.max_active = 0

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host, path = request.url.host, request.url.path
        if host == "api.elevenlabs.io" and path.startswith("/v1/text-to-speech/"):
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            await asyncio.sleep(0.02)
            self.active -= 1
            return httpx.Response(200, content=FAKE_MP3, headers={"content-type": "audio/mpeg"})
        if host == "api.elevenlabs.io" and path == "/v1/speech-to-text":
            return httpx.Response(200, json={"text": " hello world ", "language_code": "en"})
        return httpx.Response(404)

    def calls(self, needle: str) -> list[httpx.Request]:
        return [r for r in self.requests if needle in r.url.path or needle in r.url.host]


@pytest.fixture
def upstream() -> Upstream:
    return Upstream()


def make_client(tmp_path: Path, upstream: Upstream, **overrides) -> TestClient:
    kwargs = {
        "_env_file": None,
        "state_dir": tmp_path / "state",
        "elevenlabs_api_key": ELEVEN_KEY,
    }
    kwargs.update(overrides)
    app = create_app(Settings(**kwargs))
    http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    app.dependency_overrides[get_voice_http] = lambda: http
    return TestClient(app)


def no_secrets(resp) -> None:
    assert ELEVEN_KEY not in resp.text
    assert ELEVEN_KEY not in str(resp.headers)


def test_tts_caches_on_disk_and_serves_media(tmp_path, upstream):
    with make_client(tmp_path, upstream) as c:
        r1 = c.post("/api/tts", json={"text": "Hello from ScholarTwin."})
        assert r1.status_code == 200, r1.text
        body = r1.json()
        assert body["cached"] is False
        assert body["url"] == f"/api/media/{body['media_id']}"
        assert len(upstream.calls("text-to-speech")) == 1

        req = upstream.calls("text-to-speech")[0]
        assert req.headers["xi-api-key"] == ELEVEN_KEY
        assert req.url.path.endswith(f"/{service.DEFAULT_VOICE_ID}")
        assert json.loads(req.content) == {
            "text": "Hello from ScholarTwin.",
            "model_id": "eleven_flash_v2_5",
        }

        r2 = c.post("/api/tts", json={"text": "Hello from ScholarTwin."})
        assert r2.json() == {**body, "cached": True}
        assert len(upstream.calls("text-to-speech")) == 1  # cache hit: no second HTTP call

        media = c.get(body["url"])
        assert media.status_code == 200
        assert media.headers["content-type"] == "audio/mpeg"
        assert media.content == FAKE_MP3
        for r in (r1, r2):
            no_secrets(r)

        assert c.get("/api/media/zzzz").status_code == 404
        assert c.get("/api/media/0123456789abcdef").status_code == 404


def test_tts_cache_key_is_text_voice_model(tmp_path, upstream):
    expected = service.media_id_for("Hi there", service.DEFAULT_VOICE_ID, service.TTS_MODEL_ID)
    with make_client(tmp_path, upstream) as c:
        a = c.post("/api/tts", json={"text": "Hi there"}).json()
        b = c.post("/api/tts", json={"text": "Hi there", "voice_id": "VOICE_two"}).json()
    assert a["media_id"] == expected
    assert a["media_id"] != b["media_id"]
    assert upstream.calls("text-to-speech")[1].url.path.endswith("/VOICE_two")
    assert (tmp_path / "state" / "media" / f"{expected}.mp3").is_file()


def test_tts_validation(tmp_path, upstream):
    with make_client(tmp_path, upstream) as c:
        assert c.post("/api/tts", json={"text": "x" * 1001}).status_code == 422
        assert c.post("/api/tts", json={"text": ""}).status_code == 422
        assert c.post("/api/tts", json={"text": "   "}).status_code == 422
        assert c.post("/api/tts", json={"text": "ok", "voice_id": "../evil"}).status_code == 422
        assert c.post("/api/tts", json={"text": "x" * 1000}).status_code == 200
    assert len(upstream.calls("text-to-speech")) == 1


def test_tts_offline_serves_only_cache(tmp_path, upstream):
    with make_client(tmp_path, upstream) as c:
        assert c.post("/api/tts", json={"text": "cached line"}).status_code == 200
    calls = len(upstream.requests)

    with make_client(tmp_path, upstream, cache_mode="offline") as c:
        hit = c.post("/api/tts", json={"text": "cached line"})
        assert hit.status_code == 200 and hit.json()["cached"] is True
        miss = c.post("/api/tts", json={"text": "never generated"})
        assert miss.status_code == 503
        assert miss.json()["error"]["code"] == "offline_cache_miss"
    assert len(upstream.requests) == calls  # offline never went to the network


def test_tts_without_key_and_uncached_is_503(tmp_path, upstream):
    with make_client(tmp_path, upstream, elevenlabs_api_key=None) as c:
        r = c.post("/api/tts", json={"text": "anything"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "voice_unavailable"
    assert not upstream.requests


def test_tts_upstream_failure_is_502_without_key(tmp_path):
    def boom(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "bad key " + ELEVEN_KEY})

    app = create_app(
        Settings(_env_file=None, state_dir=tmp_path / "s", elevenlabs_api_key=ELEVEN_KEY)
    )
    http = httpx.AsyncClient(transport=httpx.MockTransport(boom))
    app.dependency_overrides[get_voice_http] = lambda: http
    with TestClient(app) as c:
        r = c.post("/api/tts", json={"text": "hi"})
    assert r.status_code == 502
    assert "401" in r.json()["error"]["message"]
    no_secrets(r)


def test_tts_segments_ordered_cached_and_concurrency_capped(tmp_path, upstream):
    texts = [f"Segment number {i}." for i in range(9)] + ["Segment number 0."]
    with make_client(tmp_path, upstream) as c:
        r = c.post("/api/tts/segments", json={"segments": [{"text": t} for t in texts]})
        assert r.status_code == 200, r.text
        out = r.json()
        assert [o["media_id"] for o in out] == [
            service.media_id_for(t, service.DEFAULT_VOICE_ID) for t in texts
        ]
        assert all(o["url"].startswith("/api/media/") for o in out)
        no_secrets(r)
        assert 1 < upstream.max_active <= service.TTS_CONCURRENCY

        before = len(upstream.calls("text-to-speech"))
        again = c.post("/api/tts/segments", json={"segments": [{"text": t} for t in texts]})
        assert all(o["cached"] for o in again.json())
        assert len(upstream.calls("text-to-speech")) == before
        assert c.post("/api/tts/segments", json={"segments": []}).status_code == 422


def test_stt_transcribes_multipart(tmp_path, upstream):
    with make_client(tmp_path, upstream) as c:
        r = c.post("/api/stt", files={"file": ("clip.webm", b"\x1aE\xdf\xa3audio", "audio/webm")})
    assert r.status_code == 200, r.text
    assert r.json() == {"transcript": "hello world"}
    req = upstream.calls("speech-to-text")[0]
    assert req.headers["xi-api-key"] == ELEVEN_KEY
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert b'name="model_id"' in req.content and b"scribe_v1" in req.content
    assert b'name="file"' in req.content and b'filename="clip.webm"' in req.content
    no_secrets(r)


def test_stt_without_key_is_503_with_fallback_hint(tmp_path, upstream):
    with make_client(tmp_path, upstream, elevenlabs_api_key=None) as c:
        r = c.post("/api/stt", files={"file": ("clip.wav", b"RIFFdata", "audio/wav")})
    assert r.status_code == 503
    err = r.json()["error"]
    assert err["code"] == "voice_unavailable"
    assert "browser" in err["message"]
    assert not upstream.requests


def test_stt_rejects_empty_file(tmp_path, upstream):
    with make_client(tmp_path, upstream) as c:
        r = c.post("/api/stt", files={"file": ("clip.wav", b"", "audio/wav")})
    assert r.status_code == 422
    assert not upstream.requests


def test_module_is_mounted(client):
    paths = client.get("/openapi.json").json()["paths"]
    for p in ("/api/tts", "/api/tts/segments", "/api/stt"):
        assert p in paths
    assert "/api/media/{media_id}" in paths


def test_pregen_collects_fixture_texts():
    spec = importlib.util.spec_from_file_location(
        "pregen_audio", Path(__file__).resolve().parents[1] / "scripts" / "pregen_audio.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    texts = module.collect_texts(Settings(_env_file=None).fixtures_dir)
    assert len(texts) >= 6
    assert len(texts) == len(set(texts))
    assert any(t.startswith("You circled") for t in texts)


@pytest.mark.live
async def test_live_tts_then_stt(tmp_path):
    """Needs ELEVENLABS_API_KEY (run with `uv run --env-file <.env> pytest -m live`)."""
    settings = Settings(state_dir=tmp_path / "state")
    if settings.elevenlabs_api_key is None:
        pytest.skip("ELEVENLABS_API_KEY not set")
    async with httpx.AsyncClient(timeout=60) as client:
        result = await service.synthesize(settings, client, "Hello from ScholarTwin.")
        assert not result.cached
        data = result.path.read_bytes()
        assert len(data) > 1024
        transcript = await service.transcribe(
            settings, client, data, filename="hello.mp3", content_type="audio/mpeg"
        )
    assert "hello" in transcript.lower()
