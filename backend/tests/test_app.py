"""Smoke tests: the app builds, modules are discovered, legacy routes keep their old shapes."""

from __future__ import annotations

import io

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import create_app, discover_modules
from app.settings import Settings


def test_create_app_discovers_legacy(app):
    assert "legacy" in app.state.modules
    assert discover_modules()[-1] == "legacy"  # legacy is always mounted last


def test_health_has_new_and_old_fields(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {
        "status": "ok",
        "cache_mode": "live",
        "preset": None,
        "service": "ScholarTwin Phase 1",
    }


def test_offline_alias():
    s = Settings(_env_file=None, offline=True)
    assert s.cache_mode == "offline"
    with TestClient(create_app(s)) as c:
        assert c.get("/api/health").json()["cache_mode"] == "offline"


def test_settings_defaults_and_route_helpers():
    s = Settings(_env_file=None)
    assert s.model_for("ask") == "claude-opus-5-5"
    assert s.effort_for("ask") == "low"
    assert s.effort_for("hypothesis.compare") == "high"
    assert s.cors_origins == ["http://localhost:3000"]


def test_cors_origins_from_env(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings(_env_file=None).cors_origins == ["http://a.test", "http://b.test"]


def test_cors_is_explicit_not_wildcard(client):
    ok = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
    bad = client.options(
        "/api/health",
        headers={"Origin": "http://evil.test", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in bad.headers


@pytest.mark.parametrize("mode", ["lecture", "paper2sim", "hypothesis"])
def test_legacy_demo_shapes(client, mode):
    r = client.get(f"/api/demo/{mode}")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == mode
    assert {"title", "subtitle", "nodes", "edges", "simulation"} <= body.keys()
    if mode == "paper2sim":
        assert len(body["simulation"]["series"]) == 3
        assert len(body["simulation"]["x"]) == 180
    else:
        assert body["nodes"] and "category" in body["nodes"][0]


def test_legacy_demo_unknown_mode_is_404_envelope(client):
    r = client.get("/api/demo/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "http_404"


def test_legacy_simulate(client):
    r = client.post("/api/simulate", json={"gamma": 0.2, "eta": 3.0, "theta0": 1.0})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"x", "series"}
    assert [s["name"] for s in body["series"]][0].startswith("Parameter Trajectory")
    assert body["series"][0]["y"][0] == 1.0


@pytest.mark.parametrize(
    ("mode", "annotation_type"),
    [("lecture", "pulse_node"), ("paper2sim", "callout_box"), ("hypothesis", "pulse_node")],
)
def test_legacy_ask_spatial_old_shape(client, mode, annotation_type):
    r = client.post("/api/ask-spatial", json={"mode": mode, "transcript": "what is this?"})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"spoken_answer", "avatar_state", "annotations", "suggested_quiz_node_id"}
    assert body["annotations"][0]["type"] == annotation_type


def test_legacy_ingest_url_offline_fallback(client):
    r = client.post("/api/ingest/url", json={"url": "some topic words", "mode": "lecture"})
    assert r.status_code == 200
    assert len(r.json()["nodes"]) == 3


def test_legacy_ingest_pdf(client):
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Gradient descent basics\nStep size matters a lot here")
    buf = io.BytesIO(doc.tobytes())
    r = client.post(
        "/api/ingest/pdf",
        files={"file": ("lec.pdf", buf, "application/pdf")},
        data={"mode": "lecture"},
    )
    assert r.status_code == 200
    assert r.json()["nodes"][0]["label"].startswith("Gradient descent")


def test_openapi_includes_contract_models(client):
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    for name in (
        "Graph",
        "SimPayload",
        "JobEvent",
        "AskSpatialRequest",
        "AskSpatialResponse",
        "HealthResponse",
        "ErrorEnvelope",
    ):
        assert name in schemas, name
