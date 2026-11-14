"""The live smoke harness (`scripts/smoke_live.py`) run without any live call.

Two apps stand in for the backend: the real WP0 app (most routes missing -> SKIP) and a small
fake app whose routes return contract-shaped data from the shared fixtures (-> PASS), with
switches to break a route or leak an outbound HTTP request.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, Response

from app.core.fixtures import load_fixture
from app.schemas import AskSpatialResponse, Graph, SimPayload

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "smoke_live.py"
_spec = importlib.util.spec_from_file_location("smoke_live", _SCRIPT)
smoke = importlib.util.module_from_spec(_spec)
sys.modules["smoke_live"] = smoke
_spec.loader.exec_module(smoke)  # type: ignore[union-attr]


class _FileCache:
    """Stands in for a persistent CacheStore (anything but MemoryCacheStore)."""


def stub_factory(offline: bool) -> FastAPI:
    """A bare app (health only), so every other route is reported as missing."""
    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok", "cache_mode": "offline" if offline else "live", "preset": None}

    return app


def make_fake_app(*, broken_ingest: bool = False, leak_http: bool = False) -> FastAPI:
    """Every route the harness drives, backed by the shared fixtures."""
    app = FastAPI()
    lecture = load_fixture("lecture_graph", Graph)
    hypothesis = load_fixture("hypothesis_graph", Graph)
    sim = load_fixture("sim_heavy_ball", SimPayload)
    ask = load_fixture("ask_spatial_lecture", AskSpatialResponse)
    png = smoke.make_circle_png()
    node_id = lecture.nodes[0].id
    app.state.container = SimpleNamespace(cache=_FileCache())

    @app.get("/api/health")
    def health():
        return {"status": "ok", "cache_mode": "live", "preset": None}

    @app.post("/api/ingest/lecture")
    def ingest(body: bytes = b""):
        if broken_ingest:
            return Response("boom", status_code=500)
        if leak_http:  # an uncached outbound call
            transport = httpx.MockTransport(lambda r: httpx.Response(200))
            httpx.Client(transport=transport).get("https://api.anthropic.com/v1/messages")
        return {
            "graph_id": lecture.graph_id,
            "doc_id": "d_fake",
            "graph": lecture.model_dump(mode="json"),
        }

    @app.get("/api/graphs/{graph_id}")
    def graph(graph_id: str):
        return lecture.model_dump(mode="json")

    @app.get("/api/docs/{doc_id}/pages/{n}.png")
    def page(doc_id: str, n: int):
        return Response(png, media_type="image/png")

    @app.get("/api/quiz/{graph_id}/next")
    def quiz_next(graph_id: str):
        return {
            "graph_id": graph_id,
            "node_id": node_id,
            "label": "x",
            "mastery": 0.5,
            "attempts": 0,
        }

    @app.get("/api/quiz/{graph_id}/{nid}")
    def quiz(graph_id: str, nid: str):
        q = {
            "id": "q_1",
            "question": "?",
            "options": ["a", "b", "c", "d"],
            "correct_index": 2,
            "explanation": "because",
        }
        return {"graph_id": graph_id, "node_id": nid, "questions": [q]}

    @app.post("/api/quiz/{graph_id}/{nid}/answer")
    def answer(graph_id: str, nid: str, body: dict):
        assert body == {"question_id": "q_1", "choice": 2}
        return {"correct": True, "explanation": "because", "mastery": 0.7}

    @app.get("/api/mastery/{graph_id}")
    def mastery(graph_id: str):
        nodes = [
            {"node_id": n.id, "label": n.label, "mastery": 0.5, "attempts": 1}
            for n in lecture.nodes
        ]
        return {"graph_id": graph_id, "nodes": nodes}

    @app.post("/api/topics")
    def topics(body: dict):
        return {
            "graph_id": hypothesis.graph_id,
            "graph": hypothesis.model_dump(mode="json"),
            "stats": {},
        }

    @app.post("/api/ingest/paper")
    def paper():
        return {"paper_id": "arxiv_1503.01243", "method_text": "We study the ODE. " * 40}

    @app.post("/api/sim/generate")
    def generate(body: dict):
        return {"sim_id": "sim_gen_1", **sim.model_dump(mode="json")}

    @app.get("/api/sim/{sim_id}")
    def get_sim(sim_id: str):
        return sim.model_dump(mode="json")

    @app.post("/api/sim/run")
    def run(body: dict):
        assert set(body) == {"sim_id", "params"}
        return sim.default_output.model_dump(mode="json")

    @app.post("/api/ask-spatial/v2")
    def ask_v2(body: dict):
        assert body["active_context"]["view"] == "lecture" and body["cropped_image_base64"]
        return ask.model_dump(mode="json")

    @app.post("/api/tts")
    def tts(body: dict):
        return Response(b"\xff\xfb\x90" * 400, media_type="audio/mpeg")

    return app


def run_main(tmp_path: Path, argv: list[str], factory) -> tuple[int, dict]:
    out = tmp_path / "report.json"
    code = smoke.main([*argv, "--json", str(out)], app_factory=factory)
    return code, json.loads(out.read_text(encoding="utf-8"))


def by_name(report: dict) -> dict[str, dict]:
    return {s["name"]: s for s in report["steps"]}


def test_stub_app_missing_routes_are_skipped(tmp_path, capsys):
    code, report = run_main(tmp_path, ["--offline-replay"], stub_factory)
    steps = by_name(report)
    assert code == 0 and report["ok"] is True
    assert steps["health.ping"]["status"] == "PASS"
    assert steps["health.routes"]["status"] == "PASS"
    assert steps["lecture.ingest"]["label"] == "SKIP (route missing)"
    assert steps["topic.build"]["label"] == "SKIP (route missing)"
    assert steps["sim.generate"]["label"] == "SKIP (route missing)"
    assert steps["voice.tts"]["label"] == "SKIP (route missing)"
    assert steps["ask.spatial_v2"]["label"] == "SKIP (route missing)"
    assert all(s["status"] != "FAIL" for s in steps.values())
    assert any("POST /api/ingest/lecture" in m for m in report["routes"]["missing"])
    assert report["offline_replay"]["verdict"] == "SKIP"  # in-memory cache only
    out = capsys.readouterr().out
    assert "LIVE RUN" in out and "OVERALL: PASS" in out and "MISSING" in out


def test_report_structure(tmp_path):
    _, report = run_main(tmp_path, ["--only", "ask"], stub_factory)
    assert set(report) >= {"ok", "steps", "routes", "outbound_http_requests", "offline_replay"}
    step = report["steps"][0]
    assert set(step) >= {"group", "name", "status", "latency_s", "detail", "skip_kind", "net"}
    assert {s["group"] for s in report["steps"]} == {"health", "ask"}  # --only keeps health


def test_all_steps_pass_on_fake_app(tmp_path):
    code, report = run_main(tmp_path, [], lambda offline: make_fake_app())
    steps = by_name(report)
    assert code == 0, {n: s["detail"] for n, s in steps.items() if s["status"] == "FAIL"}
    assert [n for n, s in steps.items() if s["status"] != "PASS"] == []
    assert len(steps) == 16
    assert "papers=" in steps["topic.build"]["detail"]
    assert report["outbound_http_requests"] == 0


def test_flags_skip_topic_and_voice(tmp_path):
    code, report = run_main(
        tmp_path, ["--skip-topic", "--skip-voice"], lambda offline: make_fake_app()
    )
    steps = by_name(report)
    assert code == 0
    assert steps["topic.build"]["label"] == "SKIP (flag)"
    assert steps["voice.tts"]["label"] == "SKIP (flag)"


def test_failing_step_exits_1_and_dependents_skip(tmp_path, capsys):
    code, report = run_main(tmp_path, [], lambda offline: make_fake_app(broken_ingest=True))
    steps = by_name(report)
    assert code == 1 and report["ok"] is False
    assert steps["lecture.ingest"]["status"] == "FAIL"
    assert "HTTP 500" in steps["lecture.ingest"]["detail"]
    assert steps["lecture.pages"]["label"] == "SKIP (dependency)"
    assert steps["lecture.quiz"]["label"] == "SKIP (dependency)"
    assert steps["sim.run_extreme"]["status"] == "PASS"  # independent groups keep running
    assert "OVERALL: FAIL" in capsys.readouterr().out


def test_offline_replay_passes_with_zero_live_calls(tmp_path):
    code, report = run_main(tmp_path, ["--offline-replay"], lambda offline: make_fake_app())
    assert code == 0
    assert report["offline_replay"]["verdict"] == "PASS"
    assert report["offline_replay"]["run"]["outbound_http_requests"] == 0


def test_offline_replay_fails_on_live_call(tmp_path):
    def factory(offline: bool) -> FastAPI:
        return make_fake_app(leak_http=offline)

    code, report = run_main(tmp_path, ["--offline-replay"], factory)
    replay = report["offline_replay"]
    assert code == 1 and replay["verdict"] == "FAIL"
    assert any("outbound HTTP" in p for p in replay["problems"])


def test_redact_masks_secrets(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "supersecretvalue123")
    text = smoke.redact("error with supersecretvalue123 and sk-abcdefghijklmnop1234")
    assert "supersecretvalue123" not in text and "sk-abcdefghij" not in text


def test_unknown_group_is_rejected():
    with pytest.raises(SystemExit):
        smoke.parse_args(["--only", "nope"])
