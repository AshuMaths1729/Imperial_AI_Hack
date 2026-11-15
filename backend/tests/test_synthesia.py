"""Synthesia lane tests: no live calls (Synthesia is replaced by httpx.MockTransport)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.synthesia import service
from app.modules.synthesia.router import get_synthesia_http
from app.settings import Settings

KEY = "syn_test_SECRET_789"
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x01" * 4096
DOWNLOAD_URL = "https://cdn.example.com/signed/video.mp4"


class Upstream:
    """Records every request and answers like Synthesia."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = "in_progress"
        self.download: str | None = DOWNLOAD_URL
        self.create_status = 201

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host, path = request.url.host, request.url.path
        if host == "api.synthesia.io" and path == "/v2/videos" and request.method == "POST":
            if self.create_status >= 400:
                return httpx.Response(self.create_status, json={"message": "bad avatar"})
            return httpx.Response(self.create_status, json={"id": "vid-1", "status": "in_progress"})
        if host == "api.synthesia.io" and path == "/v2/videos/vid-1":
            body: dict = {"id": "vid-1", "status": self.status}
            if self.download:
                body["download"] = self.download
            return httpx.Response(200, json=body)
        if host == "cdn.example.com":
            return httpx.Response(200, content=FAKE_MP4, headers={"content-type": "video/mp4"})
        return httpx.Response(404)

    def calls(self, needle: str) -> list[httpx.Request]:
        return [r for r in self.requests if needle in str(r.url)]


@pytest.fixture
def upstream() -> Upstream:
    return Upstream()


def make_client(tmp_path: Path, upstream: Upstream, **overrides) -> TestClient:
    kwargs = {"_env_file": None, "state_dir": tmp_path / "state", "synthesia_api_key": KEY}
    kwargs.update(overrides)
    app = create_app(Settings(**kwargs))
    http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    app.dependency_overrides[get_synthesia_http] = lambda: http
    return TestClient(app)


def no_secrets(resp) -> None:
    assert KEY not in resp.text
    assert KEY not in str(resp.headers)


def create(client: TestClient, script: str = "Hello from ScholarTwin.", **extra):
    return client.post("/api/avatar/clips", json={"script": script, **extra})


def test_create_poll_download_serve(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    r = create(client)
    assert r.status_code == 202
    body = r.json()
    clip_id = body["clip_id"]
    assert body["status"] == "in_progress"
    no_secrets(r)

    # the create call: key header, test mode on by default, expected body shape
    (post,) = upstream.calls("/v2/videos")
    assert post.headers["authorization"] == KEY
    sent = json.loads(post.content)
    assert sent["test"] is True
    assert sent["visibility"] == "private"
    item = sent["input"][0]
    assert item["scriptText"] == "Hello from ScholarTwin."
    assert item["avatar"] == service.AVATAR_ID
    assert item["background"] == service.BACKGROUND

    # still rendering
    r = client.get(f"/api/avatar/clips/{clip_id}")
    assert r.status_code == 200
    assert r.json() == {
        "clip_id": clip_id,
        "status": "in_progress",
        "ready": False,
        "video_url": None,
        "script": "Hello from ScholarTwin.",
        "error": None,
    }
    assert client.get(f"/api/avatar/clips/{clip_id}/video").status_code == 404
    assert not upstream.calls("cdn.example.com")

    # complete -> downloaded once, served as video/mp4
    upstream.status = "complete"
    r = client.get(f"/api/avatar/clips/{clip_id}")
    data = r.json()
    assert data["status"] == "complete" and data["ready"] is True
    assert data["video_url"] == f"/api/avatar/clips/{clip_id}/video"
    no_secrets(r)
    mp4 = tmp_path / "state" / "clips" / f"{clip_id}.mp4"
    assert mp4.read_bytes() == FAKE_MP4
    # the presigned download must not carry the API key
    (dl,) = upstream.calls("cdn.example.com")
    assert "authorization" not in dl.headers

    v = client.get(data["video_url"])
    assert v.status_code == 200
    assert v.headers["content-type"] == "video/mp4"
    assert v.content == FAKE_MP4

    # final state: no more network calls on read
    before = len(upstream.requests)
    assert client.get(f"/api/avatar/clips/{clip_id}").json()["ready"] is True
    assert len(upstream.requests) == before

    # persisted record
    rec = json.loads((tmp_path / "state" / "clips" / f"{clip_id}.json").read_text())
    assert rec["synthesia_id"] == "vid-1" and rec["status"] == "complete"
    assert KEY not in json.dumps(rec)


def test_create_is_idempotent(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    first = create(client)
    assert first.status_code == 202
    n = len(upstream.requests)
    second = create(client)
    assert second.status_code == 200
    assert second.json()["clip_id"] == first.json()["clip_id"]
    assert len(upstream.requests) == n  # no HTTP call for the existing clip
    # a different script is a different clip
    assert create(client, "Another sentence.").json()["clip_id"] != first.json()["clip_id"]


def test_clip_id_depends_on_avatar_and_test_mode():
    a = service.clip_id_for("x", "av1", "bg", True)
    assert a == service.clip_id_for("x", "av1", "bg", True)
    assert a != service.clip_id_for("x", "av2", "bg", True)
    assert a != service.clip_id_for("x", "av1", "bg", False)
    assert service.CLIP_ID_RE.fullmatch(a)


def test_missing_key_is_503(tmp_path, upstream):
    client = make_client(tmp_path, upstream, synthesia_api_key=None)
    r = create(client)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "synthesia_unavailable"
    assert "SYNTHESIA_API_KEY" in r.json()["error"]["message"]
    assert not upstream.requests


def test_offline_never_calls_synthesia(tmp_path, upstream):
    online = make_client(tmp_path, upstream)
    clip_id = create(online).json()["clip_id"]
    upstream.requests.clear()

    offline = make_client(tmp_path, upstream, cache_mode="offline")
    # stored record -> returned, no network (even though it is still in_progress)
    r = create(offline)
    assert r.status_code == 200 and r.json()["clip_id"] == clip_id
    assert offline.get(f"/api/avatar/clips/{clip_id}").json()["status"] == "in_progress"
    # unknown script -> 503 OfflineCacheMiss
    miss = create(offline, "Never rendered before.")
    assert miss.status_code == 503
    assert miss.json()["error"]["code"] == "offline_cache_miss"
    assert not upstream.requests


def test_lookup_does_not_create(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    r = client.post("/api/avatar/clips/lookup", json={"script": "Hello from ScholarTwin."})
    assert r.status_code == 200
    miss = r.json()
    assert miss["found"] is False and miss["ready"] is False and miss["video_url"] is None
    assert not upstream.requests
    assert not (tmp_path / "state" / "clips").exists()

    created = create(client).json()
    assert miss["clip_id"] == created["clip_id"]  # same hash as create
    found = client.post("/api/avatar/clips/lookup", json={"script": "Hello from ScholarTwin."})
    assert found.json()["found"] is True
    assert found.json()["status"] == "in_progress" and found.json()["ready"] is False

    upstream.status = "complete"
    client.get(f"/api/avatar/clips/{created['clip_id']}")
    n = len(upstream.requests)
    done = client.post("/api/avatar/clips/lookup", json={"script": "Hello from ScholarTwin."})
    assert done.json()["ready"] is True
    assert done.json()["video_url"] == f"/api/avatar/clips/{created['clip_id']}/video"
    assert len(upstream.requests) == n  # lookup is local only


@pytest.mark.parametrize("raw", ["error", "failed", "rejected"])
def test_failed_statuses(tmp_path, upstream, raw):
    client = make_client(tmp_path, upstream)
    clip_id = create(client).json()["clip_id"]
    upstream.status = raw
    data = client.get(f"/api/avatar/clips/{clip_id}").json()
    assert data["status"] == "error" and data["ready"] is False
    assert raw in data["error"]
    # an errored clip is resubmitted by a new POST
    upstream.requests.clear()
    again = create(client)
    assert again.status_code == 202
    assert len(upstream.calls("/v2/videos")) == 1


def test_unknown_status_stays_in_progress(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    clip_id = create(client).json()["clip_id"]
    upstream.status = "wibble"
    assert client.get(f"/api/avatar/clips/{clip_id}").json()["status"] == "in_progress"
    upstream.status = "completed"  # alias of complete
    assert client.get(f"/api/avatar/clips/{clip_id}").json()["ready"] is True


def test_normalize_status():
    assert service.normalize_status("complete") == "complete"
    assert service.normalize_status("COMPLETED") == "complete"
    for s in ("error", "failed", "rejected"):
        assert service.normalize_status(s) == "error"
    for s in ("in_progress", "approved", "queued", "", None):
        assert service.normalize_status(s) == "in_progress"


def test_complete_without_download_link_retries(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    clip_id = create(client).json()["clip_id"]
    upstream.status, upstream.download = "complete", None
    assert client.get(f"/api/avatar/clips/{clip_id}").json()["status"] == "in_progress"
    upstream.download = DOWNLOAD_URL
    assert client.get(f"/api/avatar/clips/{clip_id}").json()["ready"] is True


def test_script_length_limit(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    assert create(client, "x" * 3000).status_code == 202
    r = create(client, "x" * 3001)
    assert r.status_code == 422
    assert create(client, "   ").status_code == 422
    assert client.post("/api/avatar/clips/lookup", json={"script": "x" * 3001}).status_code == 422


def test_upstream_create_error_is_502_without_key(tmp_path, upstream):
    upstream.create_status = 400
    client = make_client(tmp_path, upstream)
    r = create(client)
    assert r.status_code == 502
    assert "bad avatar" in r.json()["error"]["message"]
    no_secrets(r)
    assert not (tmp_path / "state" / "clips").exists()


@pytest.mark.parametrize(
    "bad", ["..", "abc", "../../etc/passwd", "ABCDEF0123456789", "0123456789abcdeg", "0" * 17]
)
def test_clip_id_path_safety(tmp_path, upstream, bad):
    client = make_client(tmp_path, upstream)
    secret = tmp_path / "state" / "secret.json"
    secret.parent.mkdir(parents=True, exist_ok=True)
    secret.write_text("{}")
    assert client.get(f"/api/avatar/clips/{bad}").status_code in (404, 422)
    assert client.get(f"/api/avatar/clips/{bad}/video").status_code in (404, 422)
    assert service.video_path(client.app.state.container.settings, bad) is None
    assert service.load_record(client.app.state.container.settings, bad) is None
    assert not upstream.requests


def test_unknown_but_valid_clip_id_is_404(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    assert client.get("/api/avatar/clips/0123456789abcdef").status_code == 404
    assert client.get("/api/avatar/clips/0123456789abcdef/video").status_code == 404


def test_list_clips(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    assert client.get("/api/avatar/clips").json() == []
    a = create(client, "First.", title="First clip").json()["clip_id"]
    create(client, "Second.")
    upstream.status = "complete"
    client.get(f"/api/avatar/clips/{a}")
    rows = client.get("/api/avatar/clips").json()
    assert len(rows) == 2
    by_id = {r["clip_id"]: r for r in rows}
    assert by_id[a]["title"] == "First clip" and by_id[a]["ready"] is True


def test_avatar_session_modes(tmp_path, upstream):
    r = make_client(tmp_path, upstream).post("/api/avatar/session")
    assert r.json() == {"mode": "clips", "ready_clips": 0, "can_render": True}
    assert r.headers["cache-control"] == "no-store"
    no_secrets(r)

    keyless = make_client(tmp_path / "k", upstream, synthesia_api_key=None)
    assert keyless.post("/api/avatar/session").json() == {
        "mode": "audio_only",
        "ready_clips": 0,
        "can_render": False,
    }

    # no key but a ready clip cached -> still `clips`
    client = make_client(tmp_path / "c", upstream)
    clip_id = create(client).json()["clip_id"]
    upstream.status = "complete"
    client.get(f"/api/avatar/clips/{clip_id}")
    nokey = make_client(tmp_path / "c", upstream, synthesia_api_key=None)
    assert nokey.post("/api/avatar/session").json() == {
        "mode": "clips",
        "ready_clips": 1,
        "can_render": False,
    }
    offline = make_client(tmp_path / "c", upstream, cache_mode="offline")
    assert offline.post("/api/avatar/session").json()["can_render"] is False


def test_key_never_in_any_response(tmp_path, upstream):
    client = make_client(tmp_path, upstream)
    resps = [create(client)]
    clip_id = resps[0].json()["clip_id"]
    upstream.status = "complete"
    resps += [
        client.get(f"/api/avatar/clips/{clip_id}"),
        client.get(f"/api/avatar/clips/{clip_id}/video"),
        client.get("/api/avatar/clips"),
        client.post("/api/avatar/session"),
        client.post("/api/avatar/clips/lookup", json={"script": "Hello from ScholarTwin."}),
    ]
    for r in resps:
        assert KEY not in r.text and KEY not in str(r.headers)


def _load_prerender():
    path = Path(__file__).resolve().parents[1] / "scripts" / "prerender_avatar_clips.py"
    spec = importlib.util.spec_from_file_location("prerender_avatar_clips", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_prerender_script_collects_and_runs(tmp_path, upstream):
    mod = _load_prerender()
    fx = tmp_path / "fx"
    fx.mkdir()
    (fx / "ask_spatial_a.json").write_text(
        json.dumps(
            {"spoken_answer": "Full answer.", "segments": [{"text": "Seg one."}, {"text": ""}]}
        )
    )
    items = mod.dedupe(mod.collect_fixture_scripts(fx))
    assert [i["script"] for i in items] == ["Full answer.", "Seg one."]

    scripts = tmp_path / "s.json"
    scripts.write_text(json.dumps(["Plain.", {"title": "Titled", "script": "Obj."}]))
    assert [i["title"] for i in mod.load_scripts_file(scripts)] == ["Plain.", "Titled"]

    upstream.status = "complete"  # first poll finishes
    settings = Settings(_env_file=None, state_dir=tmp_path / "state", synthesia_api_key=KEY)
    http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    import asyncio

    rows = asyncio.run(mod.run(settings, items, test=True, timeout=30, interval=0.01, client=http))
    assert [r["status"] for r in rows] == ["complete", "complete"]
    assert all((tmp_path / "state" / "clips" / f"{r['clip_id']}.mp4").is_file() for r in rows)
    sent = [json.loads(r.content) for r in upstream.calls("/v2/videos") if r.method == "POST"]
    assert all(s["test"] is True for s in sent)
