"""Smoke tests: the app builds, modules are discovered, health/CORS/OpenAPI behave."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app, discover_modules
from app.settings import Settings


def test_create_app_discovers_modules(app):
    expected = {
        "ask", "health", "hypothesis", "lecture", "paper_ingest",
        "presets", "quiz", "sim", "synthesia", "voice",
    }
    assert expected <= set(app.state.modules)
    assert not {"legacy", "fixtures_api"} & set(app.state.modules)
    assert discover_modules() == sorted(discover_modules())


def test_health_shape(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "cache_mode": "live", "preset": None}


def test_health_reports_loaded_preset(tmp_path):
    (tmp_path / "_preset.json").write_text('{"name": "demo"}', encoding="utf-8")
    with TestClient(create_app(Settings(_env_file=None, state_dir=tmp_path))) as c:
        assert c.get("/api/health").json()["preset"] == "demo"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/demo/lecture"),
        ("post", "/api/simulate"),
        ("get", "/api/graphs/g_demo_lecture"),
        ("get", "/api/sim/sim_heavy_ball"),
        ("get", "/api/jobs/j_demo_lecture/events"),
    ],
)
def test_demo_routes_and_ids_are_gone(client, method, path):
    assert getattr(client, method)(path).status_code == 404


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
