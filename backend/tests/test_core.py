"""Interfaces and fakes: cache, jobs, errors, registry, broker, LLM, extractors, deps."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.cache import CacheStore, MemoryCacheStore
from app.core.errors import (
    AppError,
    ExtractorUnavailable,
    OfflineCacheMiss,
    SchemaValidationError,
    ToolNotAllowed,
    UpstreamError,
    install_error_handlers,
)
from app.core.jobs import InProcessJobRunner, JobContext, JobRunner, Stage, run_stages
from app.deps import get_broker, get_cache, get_extractor, get_jobs, get_llm, get_settings
from app.llm.client import LLMClient, ParseRequest
from app.llm.extractor import Extractor, ExtractorRegistry
from app.llm.testing import FakeLLM
from app.main import create_app
from app.schemas import JobEvent
from app.settings import Settings
from app.tools.broker import Broker, PassthroughBroker, RouteBroker
from app.tools.registry import McpServerConfig, Registry, RoutePolicy, ToolDef
from app.tools.testing import FakeBroker, Queue


class Item(BaseModel):
    name: str
    n: int = 0


# ------------------------------------------------------------------------------- cache
async def test_memory_cache_roundtrip_and_isolation():
    cache: CacheStore = MemoryCacheStore()
    assert await cache.get("ns", "k") is None
    value = {"a": [1, 2]}
    await cache.put("ns", "k", value)
    value["a"].append(3)  # caller mutation must not leak in
    got = await cache.get("ns", "k")
    assert got == {"a": [1, 2]}
    got["a"].append(9)
    assert await cache.get("ns", "k") == {"a": [1, 2]}

    await cache.put_blob("img", "k", b"\x89PNG")
    assert await cache.get_blob("img", "k") == b"\x89PNG"
    assert await cache.get_blob("img", "missing") is None

    await cache.put_artifact("item", "i1", Item(name="x", n=2))
    assert await cache.get_artifact("item", "i1", Item) == Item(name="x", n=2)
    assert await cache.get_artifact("item", "i2", Item) is None


# -------------------------------------------------------------------------------- jobs
async def test_job_runner_done_with_result_and_replay():
    runner: JobRunner = InProcessJobRunner()

    async def job(ctx: JobContext) -> str:
        ctx.emit("a", 10, "starting")
        await asyncio.sleep(0)
        ctx.emit("b", 60)
        return "result_1"

    job_id = runner.submit("test", job)
    events = [e async for e in runner.subscribe(job_id)]
    assert [(e.seq, e.stage) for e in events] == [(0, "a"), (1, "b"), (2, "done")]
    assert events[-1].result_id == "result_1" and events[-1].pct == 100
    # a late subscriber gets the same history; after_seq resumes
    assert [e async for e in runner.subscribe(job_id)] == events
    assert [e.seq async for e in runner.subscribe(job_id, after_seq=1)] == [2]


async def test_job_runner_error_event_and_unknown_job():
    runner = InProcessJobRunner()

    async def boom(ctx: JobContext) -> None:
        ctx.emit("work", 40)
        raise UpstreamError("nope")

    job_id = runner.submit("test", boom)
    events = [e async for e in runner.subscribe(job_id)]
    assert events[-1].stage == "error" and events[-1].pct == 40
    assert "upstream_error" in (events[-1].message or "")
    with pytest.raises(AppError):
        runner.subscribe("j_missing")


async def test_run_stages_emits_one_event_per_stage_and_threads_values():
    seen: list[JobEvent] = []
    ctx = JobContext("j", "k", seen.append)

    async def double(_ctx, x):
        return x * 2

    async def inc(_ctx, x):
        return x + 1

    out = await run_stages(ctx, [("double", double), Stage("inc", inc, weight=3)], 5)
    assert out == 11
    assert [(e.stage, e.pct) for e in seen] == [("double", 0.0), ("inc", 25.0)]


# ------------------------------------------------------------------------------ errors
def test_error_envelope_for_app_errors_and_unhandled():
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/miss")
    def miss():
        raise OfflineCacheMiss("no cache", details={"tool": "t"})

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internals")

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/miss")
        assert r.status_code == 503
        assert r.json() == {
            "error": {"code": "offline_cache_miss", "message": "no cache", "details": {"tool": "t"}}
        }
        r = c.get("/boom")
        assert r.status_code == 500
        assert r.json()["error"] == {
            "code": "internal_error",
            "message": "Internal server error",
            "details": None,
        }


# ------------------------------------------------------------------- registry / broker
def test_registry_rejects_duplicates_and_extractor_placeholder_replacement():
    reg = Registry()
    tool = ToolDef("t", "d", Item, fn=lambda **_: None, trust="untrusted")
    reg.add_tool(tool)
    with pytest.raises(ValueError):
        reg.add_tool(tool)
    reg.add_policy(RoutePolicy("r", allowed_tools=frozenset({"t"})))
    reg.add_mcp_server(McpServerConfig("tavily", "https://x", "TAVILY_API_KEY", flag=None))

    ex = ExtractorRegistry()
    ex.register("frontier", lambda ctx: object(), placeholder=True)
    ex.register("frontier", lambda ctx: object())  # real replaces placeholder
    assert not ex.is_placeholder("frontier")
    with pytest.raises(ValueError):
        ex.register("frontier", lambda ctx: object())
    with pytest.raises(ExtractorUnavailable):
        ex.create("finetuned", None)  # type: ignore[arg-type]


async def test_passthrough_broker_policy_and_offline():
    reg = Registry()
    reg.add_policy(RoutePolicy("r", allowed_tools=frozenset({"ok"})))

    async def fn():
        return {"name": "a"}

    broker: Broker = PassthroughBroker(reg, Settings(_env_file=None))
    rb: RouteBroker = broker.for_route("r")
    assert await rb.call("ok", {}, fn, result_type=Item) == Item(name="a")
    with pytest.raises(ToolNotAllowed):
        await rb.call("other", {}, fn)
    offline = PassthroughBroker(reg, Settings(_env_file=None, offline=True)).for_route("r")
    with pytest.raises(OfflineCacheMiss):
        await offline.call("ok", {}, fn)


async def test_fake_broker_replays_and_records():
    calls: list[int] = []

    async def live():
        calls.append(1)
        return {"name": "live"}

    fb = FakeBroker(
        {
            "search": {"name": "any-args"},
            FakeBroker.key("search", {"q": "x"}): {"name": "exact"},
            "seq": Queue([{"name": "one"}, {"name": "two"}]),
            "s2": {"data": [1]},
            "s2:GET https://api/x": {"data": [2]},
        }
    )
    rb = fb.for_route("hypothesis.fetch")
    assert await rb.call("search", {"q": "x"}, live, result_type=Item) == Item(name="exact")
    assert await rb.call("search", {"q": "y"}, live) == {"name": "any-args"}
    assert (await rb.call("seq", {}, live))["name"] == "one"
    assert (await rb.call("seq", {}, live))["name"] == "two"
    assert await rb.http("s2", "GET", "https://api/x") == {"data": [2]}
    assert await rb.http("s2", "GET", "https://api/other") == {"data": [1]}
    assert calls == []  # fn never ran: results were replayed
    assert [c.tool for c in fb.calls] == ["search", "search", "seq", "seq", "s2", "s2"]
    assert fb.calls_to("seq")[0].route == "hypothesis.fetch"
    with pytest.raises(OfflineCacheMiss):
        await rb.call("unknown", {}, live)
    assert await FakeBroker(strict=False).for_route("r").call("unknown", {}, live) == {
        "name": "live"
    }


# ---------------------------------------------------------------------------------- llm
async def test_fake_llm_validates_against_requested_output_type():
    llm: LLMClient = FakeLLM()
    llm.queue("r", Item(name="a"), {"name": "b", "n": 2}, '{"name": "c"}', {"wrong": 1})  # type: ignore[attr-defined]
    assert (await llm.parse("r", "p", "c", Item)).output == Item(name="a")
    assert (await llm.parse("r", "p", "c", Item)).output == Item(name="b", n=2)
    assert (await llm.parse("r", "p", "c", Item)).output.name == "c"
    with pytest.raises(SchemaValidationError):
        await llm.parse("r", "p", "c", Item)
    with pytest.raises(UpstreamError):
        await llm.parse("empty", "p", "c", Item)


async def test_fake_llm_batch_agent_and_calls():
    llm = FakeLLM(outputs={"r": {"name": "z"}})
    res = await llm.batch_parse("r", [ParseRequest("p1"), ParseRequest("p2")], Item)
    assert [r.output.name for r in res] == ["z", "z"]
    out = await llm.agent("r", "go", output=None)
    assert out.output == {"name": "z"}
    assert [c.method for c in llm.calls] == ["batch_parse", "batch_parse", "agent"]


# ------------------------------------------------------------------------------- deps
def test_deps_providers_return_registered_implementations(app):
    c = app.state.container
    assert isinstance(c.cache, CacheStore)
    assert isinstance(c.jobs, JobRunner)
    assert isinstance(c.broker, Broker)
    assert isinstance(c.llm, LLMClient)

    @app.get("/_probe")
    async def probe(
        s: Settings = Depends(get_settings),
        cache: CacheStore = Depends(get_cache),
        jobs: JobRunner = Depends(get_jobs),
        broker: Broker = Depends(get_broker),
        llm: LLMClient = Depends(get_llm),
        extractor: Extractor = Depends(get_extractor),
    ):
        graph = await extractor.lecture_graph(None)
        return {
            "same": [
                s is c.settings,
                cache is c.cache,
                jobs is c.jobs,
                broker is c.broker,
                llm is c.llm,
            ],
            "graph_kind": graph.kind,
        }

    with TestClient(app) as client:
        body = client.get("/_probe").json()
        assert body == {"same": [True] * 5, "graph_kind": "lecture"}
        # per-request override of the extractor backend
        r = client.get("/_probe", params={"extractor": "finetuned"})
        assert r.status_code == 503 and r.json()["error"]["code"] == "extractor_unavailable"


def test_module_register_hook_is_called(tmp_path, monkeypatch):
    """A module exporting `register(reg)` gets the shared registry at startup."""
    pkg = tmp_path / "zz_probe"
    pkg.mkdir()
    (pkg / "__init__.py").write_text(
        "from app.tools.registry import RoutePolicy\n"
        "def register(reg):\n"
        "    reg.add_policy(RoutePolicy('probe.route'))\n",
        encoding="utf-8",
    )
    import app.modules as modules_pkg

    monkeypatch.setattr(modules_pkg, "__path__", [*modules_pkg.__path__, str(tmp_path)])
    app = create_app(Settings(_env_file=None))
    assert "zz_probe" in app.state.modules
    assert "probe.route" in app.state.container.registry.policies
