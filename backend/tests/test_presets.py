"""Demo Preset mode: freeze/load round trip, secret scan, traversal safety, speed. No live calls."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.presets import service
from app.settings import Settings


def make_settings(tmp_path: Path, **kw) -> Settings:
    args = {
        "cache_mode": "offline",
        "state_dir": tmp_path / "state",
        "cache_dir": tmp_path / "cache",
        "presets_dir": tmp_path / "presets",
        **kw,
    }
    return Settings(_env_file=None, **args)


def write(path: Path, text: str = "{}") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def seed(settings: Settings) -> None:
    write(settings.state_dir / "graphs" / "g1.json", '{"nodes": []}')
    write(settings.state_dir / "graphs" / "g2.json")
    write(settings.state_dir / "sims" / "s1.json")
    write(settings.state_dir / "quizzes" / "q1.json")
    write(settings.state_dir / "media" / "a.mp3", "audio")
    write(settings.state_dir / "docs" / "d1" / "pages" / "p1.png", "png")
    write(settings.state_dir / "mastery" / "u1.json", '{"secret_progress": 1}')
    write(settings.state_dir / "_preset.json", '{"name": "old"}')
    write(settings.cache_dir / "abc.json", '{"r": 1}')
    write(settings.cache_dir / "def.json", '{"r": 2}')


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_freeze_load_round_trip(settings, client):
    seed(settings)
    r = client.post("/api/presets/demo/freeze")
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["counts"]["graphs"] == 2
    assert m["counts"]["sims"] == 1
    assert m["counts"]["quizzes"] == 1
    assert m["counts"]["media"] == 1
    assert m["counts"]["cache"] == 2
    assert m["counts"]["docs"] == 1
    assert m["files"] == 8
    assert "created_at" in m

    pdir = settings.presets_dir / "demo"
    assert (pdir / "manifest.json").is_file()
    assert (pdir / "state" / "graphs" / "g1.json").is_file()
    assert (pdir / "cache" / "abc.json").is_file()
    assert not (pdir / "state" / "mastery").exists()  # mastery is never frozen
    assert not (pdir / "state" / "_preset.json").exists()

    # wipe live data except mastery, plus one unrelated file that load must not delete
    for sub in ("graphs", "sims", "quizzes", "media", "docs"):
        for p in sorted((settings.state_dir / sub).rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
    (settings.cache_dir / "abc.json").unlink()
    write(settings.cache_dir / "keep.json", "keep")
    write(settings.state_dir / "graphs" / "g1.json", "STALE")

    r = client.post("/api/presets/demo/load")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["loaded"] == "demo" and body["files"] == 8 and body["ms"] < 1000
    assert json.loads((settings.state_dir / "graphs" / "g1.json").read_text()) == {"nodes": []}
    assert (settings.state_dir / "docs" / "d1" / "pages" / "p1.png").read_text() == "png"
    assert (settings.cache_dir / "abc.json").is_file()
    assert (settings.cache_dir / "keep.json").read_text() == "keep"
    assert (settings.state_dir / "mastery" / "u1.json").is_file()

    assert client.get("/api/presets/current").json() == {"name": "demo"}
    listing = client.get("/api/presets").json()
    assert listing["current"] == "demo"
    assert [p["name"] for p in listing["presets"]] == ["demo"]
    assert listing["presets"][0]["counts"]["graphs"] == 2

    assert client.post("/api/presets/unload").json() == {"name": None}
    assert client.get("/api/presets/current").json() == {"name": None}
    assert (settings.state_dir / "graphs" / "g1.json").is_file()  # data not deleted


def test_list_empty_and_current_null(client):
    assert client.get("/api/presets").json() == {"presets": [], "current": None}


def test_load_missing_is_404(client):
    assert client.post("/api/presets/nope/load").status_code == 404


def test_overwrite_flag(settings, client):
    seed(settings)
    assert client.post("/api/presets/demo/freeze").status_code == 200
    write(settings.presets_dir / "demo" / "script.json", '{"steps": []}')
    r = client.post("/api/presets/demo/freeze")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "preset_exists"

    write(settings.state_dir / "graphs" / "g3.json")
    r = client.post("/api/presets/demo/freeze?overwrite=true")
    assert r.status_code == 200
    assert r.json()["counts"]["graphs"] == 3
    assert (settings.presets_dir / "demo" / "script.json").is_file()  # script survives
    assert [p.name for p in settings.presets_dir.iterdir()] == ["demo"]  # no temp leftovers


def test_include_filters_state_subdirs(settings, client):
    seed(settings)
    r = client.post("/api/presets/slim/freeze", json={"include": ["graphs"]})
    assert r.status_code == 200
    counts = r.json()["counts"]
    assert counts["graphs"] == 2 and counts["sims"] == 0 and counts["cache"] == 0
    r = client.post("/api/presets/cacheonly/freeze", json={"include": ["cache"]})
    assert r.json()["counts"]["cache"] == 2 and r.json()["counts"]["graphs"] == 0
    r = client.post("/api/presets/bad/freeze", json={"include": ["../x"]})
    assert r.status_code == 400


@pytest.mark.parametrize(
    "payload",
    [
        "see sk-" + "ant-api03-abcdef",
        '{"headers": {"xi-api-' + 'key": "abc"}}',
        "Authorization: Bear" + "er " + "a" * 24,
    ],
)
def test_secret_scan_refuses_freeze(settings, client, payload):
    seed(settings)
    write(settings.cache_dir / "leaky.json", payload)
    r = client.post("/api/presets/demo/freeze")
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "secrets_detected"
    assert err["details"]["files"] == ["cache/leaky.json"]
    assert payload not in r.text and "api03" not in r.text  # never echo matched text
    assert not (settings.presets_dir / "demo").exists()
    assert not settings.presets_dir.exists() or not any(settings.presets_dir.iterdir())


def test_short_bearer_word_is_not_a_secret(settings, client):
    seed(settings)
    write(settings.cache_dir / "ok.json", "Bearer tokens are described in the lecture")
    assert client.post("/api/presets/demo/freeze").status_code == 200


@pytest.mark.parametrize("name", ["../x", "..", "a/b", "A", "x y", "", "a" * 65, "..%2Fx", "/etc"])
def test_service_rejects_bad_names(settings, name):
    with pytest.raises(service.InvalidPresetName):
        service.preset_path(settings, name)


@pytest.mark.parametrize(
    "name", ["../x", "%2e%2e%2fx", "..%5Cx", "%2Fetc%2Fpasswd", "C%3A%5Cx", "UP"]
)
def test_http_rejects_traversal(settings, client, name):
    seed(settings)
    for verb in ("freeze", "load"):
        r = client.post(f"/api/presets/{name}/{verb}")
        assert r.status_code in (400, 404), (name, verb, r.status_code)
    assert not settings.presets_dir.exists() or not any(settings.presets_dir.iterdir())
    assert not (settings.presets_dir.parent / "x").exists()


def test_load_500_files_under_one_second(settings):
    for i in range(300):
        write(settings.state_dir / "graphs" / f"g{i}.json", json.dumps({"i": i}))
    for i in range(200):
        write(settings.cache_dir / f"c{i}.json", json.dumps({"r": i}))
    service.freeze_preset(settings, "big")
    t0 = time.perf_counter()
    res = service.load_preset(settings, "big")
    assert time.perf_counter() - t0 < 1.0
    assert res["files"] == 500 and res["ms"] < 1000


def test_load_into_fresh_dirs(tmp_path, settings):
    seed(settings)
    service.freeze_preset(settings, "demo")
    other = make_settings(tmp_path / "other", presets_dir=settings.presets_dir)
    res = service.load_preset(other, "demo")
    assert res["files"] == 8
    assert (other.state_dir / "sims" / "s1.json").is_file()
    assert (other.cache_dir / "def.json").is_file()
    assert service.current_preset(other) == "demo"


def test_verify_script_end_to_end(tmp_path):
    import os
    import subprocess
    import sys

    s = make_settings(tmp_path)
    # ids served by the fixtures stand-in routes, so this passes without other lanes merged
    fixture = Path(__file__).resolve().parents[2] / "fixtures" / "lecture_graph.json"
    write(s.state_dir / "graphs" / "g_demo_lecture.json", fixture.read_text(encoding="utf-8"))
    write(s.state_dir / "media" / "a.mp3", "audio")
    write(s.cache_dir / "k.json")
    service.freeze_preset(s, "demo")
    script = Path(__file__).resolve().parents[1] / "scripts" / "verify_preset.py"
    env = {**os.environ, "PRESETS_DIR": str(s.presets_dir), "STATE_DIR": str(s.state_dir)}
    out = subprocess.run(
        [sys.executable, str(script), "demo"], capture_output=True, text=True, env=env, timeout=60
    )
    assert out.returncode == 0, out.stdout + out.stderr
    assert "PASS graph g_demo_lecture" in out.stdout
    assert "SUMMARY" in out.stdout and "0 failed" in out.stdout
