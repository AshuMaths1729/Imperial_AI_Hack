"""End-to-end smoke test of the whole ScholarTwin backend with the REAL services.

Builds the app with `create_app()` and drives it through FastAPI's TestClient (no port).
Keys are injected by the caller; this script never reads or prints them:

    cd backend
    uv run --env-file D:/Projects/Imperial_AI_Hack/.env python scripts/smoke_live.py
    uv run --env-file ... python scripts/smoke_live.py --only lecture,ask --skip-voice
    uv run --env-file ... python scripts/smoke_live.py --offline-replay --json out.json

Groups: health (always), lecture, topic, sim, ask, voice. A missing route is reported as
`SKIP (route missing)` rather than a failure, so it works on partial merges. Exit code 1 if
any non-skipped step fails (or the offline replay finds a miss / a live call).

`--offline-replay` re-runs every step with `Settings(cache_mode="offline")` on a fresh app
and checks that everything that passed live is served from cache with zero outbound HTTP
requests (the demo must work with no network). SKIP if the tree has no persistent cache.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402
import pymupdf  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel, ValidationError  # noqa: E402

from app.schemas import (  # noqa: E402
    ActiveContext,
    AskSpatialRequest,
    AskSpatialResponse,
    Graph,
    HitMetadata,
    ParamSpec,
    SimOutput,
    SimPayload,
)

GROUPS = ("health", "lecture", "topic", "sim", "ask", "voice")

# lane -> expected (method, path); `{x}` segments are normalised so names don't matter
EXPECTED_ROUTES: dict[str, list[tuple[str, str]]] = {
    "lecture": [
        ("POST", "/api/ingest/lecture"),
        ("GET", "/api/graphs/{graph_id}"),
        ("GET", "/api/docs/{doc_id}/pages/{n}.png"),
        ("GET", "/api/quiz/{graph_id}/{node_id}"),
        ("POST", "/api/quiz/{graph_id}/{node_id}/answer"),
        ("GET", "/api/quiz/{graph_id}/next"),
        ("GET", "/api/mastery/{graph_id}"),
    ],
    "topic": [("POST", "/api/topics"), ("GET", "/api/papers/{paper_id}")],
    "sim": [
        ("POST", "/api/sim/generate"),
        ("GET", "/api/sim/{sim_id}"),
        ("POST", "/api/sim/run"),
    ],
    "paper_ingest": [("POST", "/api/ingest/paper")],
    "llm": [("POST", "/api/ask-spatial/v2")],
    "voice": [
        ("POST", "/api/tts"),
        ("POST", "/api/stt"),
        ("POST", "/api/avatar/session"),
    ],
    "presets": [
        ("GET", "/api/presets"),
        ("POST", "/api/presets/{name}/freeze"),
        ("POST", "/api/presets/{name}/load"),
    ],
}

SIM_HINT = (
    "simulate the ODE X'' + (3/t) X' + grad f(X) = 0 for f(x)=x^2/2 "
    "with adjustable damping coefficient r and step"
)
TTS_TEXT = "Gradient descent follows the negative gradient."
TOPIC_QUERY = {"query": "solid-state battery electrolytes", "max_papers": 6}
ARXIV_ID = "1503.01243"
SEEDED_SIM = "sim_heavy_ball"


# --------------------------------------------------------------------------- plumbing
class StepFail(Exception):
    """A check failed; the message is the one-line reason."""


class StepSkip(Exception):
    def __init__(self, reason: str, kind: str = "dependency") -> None:
        super().__init__(reason)
        self.kind = kind


@dataclass
class StepResult:
    group: str
    name: str
    status: str  # PASS | FAIL | SKIP
    latency_s: float
    detail: str = ""
    skip_kind: str = ""  # route missing | flag | dependency
    net: int = 0  # outbound (non-TestClient) httpx requests during the step

    @property
    def label(self) -> str:
        return f"SKIP ({self.skip_kind})" if self.status == "SKIP" else self.status


class NetCounter:
    """Counts outbound httpx requests (every SDK used here goes through httpx). The
    TestClient's own in-process requests (host `testserver`) are not counted."""

    def __init__(self) -> None:
        self.n = 0
        self._lock = threading.Lock()
        self._installed = False

    def bump(self, request: httpx.Request) -> None:
        if request.url.host != "testserver":
            with self._lock:
                self.n += 1

    def install(self) -> None:
        if self._installed:
            return
        self._installed = True
        sync_send, async_send = httpx.Client.send, httpx.AsyncClient.send
        counter = self

        def send(self_: httpx.Client, request: httpx.Request, **kw: Any) -> httpx.Response:
            counter.bump(request)
            return sync_send(self_, request, **kw)

        async def asend(
            self_: httpx.AsyncClient, request: httpx.Request, **kw: Any
        ) -> httpx.Response:
            counter.bump(request)
            return await async_send(self_, request, **kw)

        httpx.Client.send = send  # type: ignore[method-assign]
        httpx.AsyncClient.send = asend  # type: ignore[method-assign]


NET = NetCounter()

_SECRET_ENV = re.compile(r"KEY|TOKEN|SECRET|PASSWORD", re.I)


def redact(text: str) -> str:
    for name, value in os.environ.items():
        if _SECRET_ENV.search(name) and len(value) >= 8:
            text = text.replace(value, "***")
    return re.sub(r"(sk-|xi-|Bearer\s+)[A-Za-z0-9_\-]{10,}", r"\1***", text)


def one_line(text: str, limit: int = 180) -> str:
    text = " ".join(redact(str(text)).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def norm_path(path: str) -> str:
    return re.sub(r"\{[^}/]*\}", "{}", path)


def find_key(obj: Any, key: str) -> Any:
    """First value for `key` anywhere in a nested dict/list (None if absent)."""
    if isinstance(obj, dict):
        if key in obj and obj[key] is not None:
            return obj[key]
        for v in obj.values():
            found = find_key(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find_key(v, key)
            if found is not None:
                return found
    return None


def validate(model: type[BaseModel], data: Any, what: str) -> Any:
    try:
        return model.model_validate(data)
    except ValidationError as e:
        err = e.errors()[0]
        loc = ".".join(str(p) for p in err["loc"])
        raise StepFail(f"{what} violates {model.__name__}: {loc}: {err['msg']}") from None


# ---------------------------------------------------------------------------- assets
class Assets:
    """Generated once per process and reused (stable bytes -> stable cache keys on replay)."""

    def __init__(self) -> None:
        self._pdf: bytes | None = None
        self._png: bytes | None = None

    @property
    def lecture_pdf(self) -> bytes:
        if self._pdf is None:
            self._pdf = make_lecture_pdf()
        return self._pdf

    @property
    def circle_png(self) -> bytes:
        if self._png is None:
            self._png = make_circle_png()
        return self._png


LECTURE_SLIDES = [
    (
        "Gradient Descent",
        [
            "Gradient descent is an iterative method for minimising a differentiable function.",
            "It repeatedly steps in the direction of steepest decrease of the loss.",
            "It is the workhorse optimiser behind training neural networks.",
        ],
    ),
    (
        "Derivatives and the Gradient",
        [
            "The derivative f'(x) measures how fast f changes as x changes.",
            "For many variables the gradient is the vector of all partial derivatives.",
            "The gradient points uphill, so we move along the negative gradient.",
            "Update rule: x_new = x - eta * grad f(x).",
        ],
    ),
    (
        "Learning Rate",
        [
            "The learning rate eta sets the size of each step.",
            "If eta is too small, convergence is very slow.",
            "If eta is too large, the iterates overshoot and can diverge.",
            "For a quadratic with curvature L, any eta below 2/L converges.",
        ],
    ),
    (
        "Momentum",
        [
            "Momentum adds a velocity term that accumulates past gradients.",
            "Update: v = beta * v + grad f(x); x = x - eta * v.",
            "Momentum damps oscillations across steep valleys and speeds up progress.",
            "It builds on the learning rate: both control how far we move each step.",
        ],
    ),
]


def make_lecture_pdf() -> bytes:
    doc = pymupdf.open()
    for title, lines in LECTURE_SLIDES:
        page = doc.new_page(width=792, height=612)
        page.insert_text((50, 80), title, fontsize=30)
        y = 150
        for line in lines:
            page.insert_text((60, y), "- " + line, fontsize=14)
            y += 40
    data = doc.tobytes()
    doc.close()
    return data


def make_circle_png() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=256, height=256)
    page.draw_circle((128, 128), 70, color=(0.85, 0.1, 0.1), width=5)
    page.draw_line((70, 190), (190, 70), color=(0.1, 0.1, 0.8), width=3)
    png = page.get_pixmap().tobytes("png")
    doc.close()
    return png


# ------------------------------------------------------------------------------ suite
class Smoke:
    def __init__(self, client: TestClient, args: argparse.Namespace, assets: Assets) -> None:
        self.client = client
        self.args = args
        self.assets = assets
        self.only = set(args.only.split(",")) | {"health"} if args.only else set(GROUPS)
        self.results: list[StepResult] = []
        self.routes: set[tuple[str, str]] = set()  # (METHOD, normalised path)
        self.route_report: dict[str, Any] = {}
        self.s: dict[str, Any] = {}  # state shared between steps

    # -- helpers ------------------------------------------------------------------
    def has(self, method: str, path: str) -> bool:
        return (method, norm_path(path)) in self.routes

    def call(
        self, method: str, path: str, ok: tuple[int, ...] = (200, 201, 202), **kw: Any
    ) -> httpx.Response:
        r = self.client.request(method, path, **kw)
        if r.status_code not in ok:
            raise StepFail(f"{method} {path.split('?')[0]} -> HTTP {r.status_code}: {_err(r)}")
        return r

    def json(self, r: httpx.Response) -> Any:
        try:
            return r.json()
        except ValueError:
            raise StepFail(f"non-JSON response ({r.headers.get('content-type')})") from None

    def need(self, key: str, why: str) -> Any:
        if key not in self.s:
            raise StepSkip(why)
        return self.s[key]

    def follow_job(self, job_id: str) -> str | None:
        """Read the job's SSE stream to its terminal event; return `result_id`."""
        with self.client.stream("GET", f"/api/jobs/{job_id}/events") as r:
            if r.status_code != 200:
                raise StepFail(f"GET /api/jobs/{{id}}/events -> HTTP {r.status_code}")
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                ev = json.loads(line[5:])
                if ev.get("stage") == "error":
                    raise StepFail(f"job failed: {ev.get('message')}")
                if ev.get("stage") == "done":
                    return ev.get("result_id")
        raise StepFail("job stream ended without a terminal event")

    def graph_from(self, body: dict[str, Any], what: str) -> Graph:
        raw = body.get("graph")
        if raw is None and body.get("job_id"):
            gid = self.follow_job(body["job_id"])
            if not gid:
                raise StepFail("job finished without result_id")
            raw = self.json(self.call("GET", f"/api/graphs/{gid}"))
        if raw is None:
            raise StepFail(f"{what} response has no `graph` and no `job_id`")
        return validate(Graph, raw, f"{what} graph")

    def step(
        self,
        group: str,
        name: str,
        fn: Callable[[], str | None],
        needs: tuple[tuple[str, str], ...] = (),
        flag: str | None = None,
    ) -> None:
        if group not in self.only:
            return
        full = f"{group}.{name}"
        if flag:
            self.results.append(StepResult(group, full, "SKIP", 0.0, flag, "flag"))
            return
        missing = [f"{m} {p}" for m, p in needs if not self.has(m, p)]
        if missing and self.routes:
            self.results.append(
                StepResult(
                    group, full, "SKIP", 0.0, "missing " + ", ".join(missing), "route missing"
                )
            )
            return
        t0, n0 = time.perf_counter(), NET.n
        status, detail, kind = "PASS", "", ""
        try:
            detail = fn() or ""
        except StepSkip as e:
            status, detail, kind = "SKIP", str(e), e.kind
        except StepFail as e:
            status, detail = "FAIL", str(e)
        except Exception as e:  # noqa: BLE001 - a smoke test reports, never crashes
            status, detail = "FAIL", f"{type(e).__name__}: {e}"
        self.results.append(
            StepResult(
                group,
                full,
                status,
                time.perf_counter() - t0,
                one_line(detail, 400),
                kind,
                NET.n - n0,
            )
        )

    # -- the suite ----------------------------------------------------------------
    def run(self) -> list[StepResult]:
        self.step("health", "ping", self.health)
        self.step("health", "routes", self.route_inventory)

        L = "lecture"
        self.step(L, "ingest", self.lecture_ingest, (("POST", "/api/ingest/lecture"),))
        self.step(L, "pages", self.lecture_pages, (("GET", "/api/docs/{id}/pages/{n}.png"),))
        self.step(L, "graph_get", self.lecture_graph_get, (("GET", "/api/graphs/{id}"),))
        self.step(L, "quiz", self.quiz_get, (("GET", "/api/quiz/{g}/{n}"),))
        self.step(L, "answer", self.quiz_answer, (("POST", "/api/quiz/{g}/{n}/answer"),))
        self.step(L, "quiz_next", self.quiz_next, (("GET", "/api/quiz/{g}/next"),))
        self.step(L, "mastery", self.mastery, (("GET", "/api/mastery/{g}"),))

        self.step(
            "topic",
            "build",
            self.topic,
            (("POST", "/api/topics"),),
            flag="--skip-topic" if self.args.skip_topic else None,
        )

        S = "sim"
        self.step(S, "seeded_get", self.sim_seeded_get, (("GET", "/api/sim/{id}"),))
        self.step(
            S,
            "seeded_run",
            self.sim_seeded_run,
            (("GET", "/api/sim/{id}"), ("POST", "/api/sim/run")),
        )
        self.step(S, "paper_ingest", self.paper_ingest, (("POST", "/api/ingest/paper"),))
        self.step(S, "generate", self.sim_generate, (("POST", "/api/sim/generate"),))
        self.step(S, "run_default", self.sim_run_default, (("POST", "/api/sim/run"),))
        self.step(S, "run_extreme", self.sim_run_extreme, (("POST", "/api/sim/run"),))

        self.step("ask", "spatial_v2", self.ask, (("POST", "/api/ask-spatial/v2"),))
        self.step(
            "voice",
            "tts",
            self.tts,
            (("POST", "/api/tts"),),
            flag="--skip-voice" if self.args.skip_voice else None,
        )
        return self.results

    # -- health -------------------------------------------------------------------
    def health(self) -> str:
        body = self.json(self.call("GET", "/api/health"))
        if body.get("status") != "ok":
            raise StepFail(f"status={body.get('status')!r}")
        return f"cache_mode={body.get('cache_mode')} preset={body.get('preset')}"

    def route_inventory(self) -> str:
        r = self.client.get("/api/openapi.json")
        if r.status_code != 200:
            r = self.client.get("/openapi.json")
        if r.status_code != 200:
            raise StepFail(f"openapi.json -> HTTP {r.status_code}")
        paths = self.json(r).get("paths", {})
        self.routes = {
            (m.upper(), norm_path(p))
            for p, ops in paths.items()
            for m in ops
            if m.lower() in {"get", "post", "put", "delete", "patch"}
        }
        present: list[str] = []
        missing: list[str] = []
        for lane, routes in EXPECTED_ROUTES.items():
            for m, p in routes:
                (present if self.has(m, p) else missing).append(f"{lane}: {m} {p}")
        self.route_report = {"present": present, "missing": missing}
        total = len(present) + len(missing)
        return f"{len(present)}/{total} expected routes present"

    # -- lecture ------------------------------------------------------------------
    def lecture_ingest(self) -> str:
        r = self.call(
            "POST",
            "/api/ingest/lecture",
            files={
                "file": ("gradient_descent_lecture.pdf", self.assets.lecture_pdf, "application/pdf")
            },
        )
        body = self.json(r)
        graph = self.graph_from(body, "lecture")
        if graph.kind != "lecture":
            raise StepFail(f"graph.kind={graph.kind!r}, expected 'lecture'")
        if body.get("graph_id") not in (None, graph.graph_id):
            raise StepFail("graph_id in response differs from graph.graph_id")
        if len(graph.nodes) < 3 or not graph.edges:
            raise StepFail(f"degenerate graph: {len(graph.nodes)} nodes, {len(graph.edges)} edges")
        doc_id = body.get("doc_id") or next(
            (n.source_ref.doc_id for n in graph.nodes if n.source_ref), None
        )
        self.s.update(graph=graph, graph_id=graph.graph_id, doc_id=doc_id)
        refs = sum(1 for n in graph.nodes if n.source_ref)
        return (
            f"{len(graph.nodes)} nodes, {len(graph.edges)} edges, {refs} with page refs, "
            f"extractor={graph.meta.extractor_used}"
        )

    def lecture_pages(self) -> str:
        doc_id = self.need("doc_id", "no doc_id (lecture.ingest did not pass)")
        sizes = []
        for n, query in ((1, "?size=thumb"), (4, "")):
            r = self.call("GET", f"/api/docs/{doc_id}/pages/{n}.png{query}")
            if not r.content.startswith(b"\x89PNG"):
                raise StepFail(f"page {n} is not a PNG ({r.headers.get('content-type')})")
            sizes.append(len(r.content))
        return f"page 1 thumb {sizes[0]}B, page 4 {sizes[1]}B"

    def lecture_graph_get(self) -> str:
        gid = self.need("graph_id", "no graph (lecture.ingest did not pass)")
        g = validate(Graph, self.json(self.call("GET", f"/api/graphs/{gid}")), "GET graph")
        if {n.id for n in g.nodes} != {n.id for n in self.s["graph"].nodes}:
            raise StepFail("GET /api/graphs/{id} nodes differ from the ingest response")
        return f"{len(g.nodes)} nodes round-trip"

    def quiz_get(self) -> str:
        gid = self.need("graph_id", "no graph (lecture.ingest did not pass)")
        node = self.s["graph"].nodes[0]
        body = self.json(self.call("GET", f"/api/quiz/{gid}/{node.id}"))
        questions = body.get("questions") if isinstance(body, dict) else None
        if not questions:
            raise StepFail("quiz response has no `questions`")
        q = questions[0]
        qid = q.get("id") or q.get("question_id")
        opts = q.get("options") or q.get("choices") or []
        if not qid or len(opts) < 2:
            raise StepFail("first question lacks id or >= 2 options")
        self.s["quiz"] = {"node_id": node.id, "qid": qid, "choice": q.get("correct_index", 0)}
        return f"{len(questions)} questions for {node.label!r}"

    def quiz_answer(self) -> str:
        gid = self.need("graph_id", "no graph (lecture.ingest did not pass)")
        quiz = self.need("quiz", "no quiz (lecture.quiz did not pass)")
        r = self.call(
            "POST",
            f"/api/quiz/{gid}/{quiz['node_id']}/answer",
            json={"question_id": quiz["qid"], "choice": quiz["choice"]},
        )
        body = self.json(r)
        if not isinstance(body.get("correct"), bool):
            raise StepFail("answer response lacks boolean `correct`")
        self.s["mastery_after_answer"] = body.get("mastery")
        return f"correct={body['correct']} mastery={body.get('mastery')}"

    def quiz_next(self) -> str:
        gid = self.need("graph_id", "no graph (lecture.ingest did not pass)")
        body = self.json(self.call("GET", f"/api/quiz/{gid}/next"))
        known = {n.id for n in self.s["graph"].nodes}
        if body.get("node_id") not in known:
            raise StepFail(f"next node_id {body.get('node_id')!r} not in graph")
        return f"next={body['node_id']}"

    def mastery(self) -> str:
        gid = self.need("graph_id", "no graph (lecture.ingest did not pass)")
        body = self.json(self.call("GET", f"/api/mastery/{gid}"))
        entries = body.get("nodes")
        if not isinstance(entries, list) or not entries:
            raise StepFail("mastery response has no `nodes`")
        quiz = self.s.get("quiz")
        if quiz and "mastery_after_answer" in self.s:
            mine = next((e for e in entries if e.get("node_id") == quiz["node_id"]), None)
            if mine is None:
                raise StepFail("answered node missing from mastery")
            if mine.get("attempts", 1) < 1:
                raise StepFail("answered node shows 0 attempts")
        return f"{len(entries)} nodes tracked"

    # -- topic --------------------------------------------------------------------
    def topic(self) -> str:
        body = self.json(self.call("POST", "/api/topics", json=TOPIC_QUERY))
        g = self.graph_from(body, "topic")
        papers = sum(1 for n in g.nodes if n.kind == "paper")
        claims = sum(1 for n in g.nodes if n.kind == "claim")
        contra = sum(1 for e in g.edges if e.type == "contradicts")
        gaps = sum(1 for e in g.edges if e.type == "gap")
        if g.kind != "hypothesis":
            raise StepFail(f"graph.kind={g.kind!r}, expected 'hypothesis'")
        if papers == 0 or claims == 0:
            raise StepFail(f"degenerate graph: papers={papers} claims={claims}")
        return f"papers={papers} claims={claims} contradicts={contra} gap={gaps}"

    # -- sim ----------------------------------------------------------------------
    def _payload_params(self, body: Any, what: str) -> dict[str, ParamSpec]:
        raw = find_key(body, "params")
        if not isinstance(raw, dict) or not raw:
            raise StepFail(f"{what} has no slider `params`")
        return {k: validate(ParamSpec, v, f"{what} param {k!r}") for k, v in raw.items()}

    def sim_seeded_get(self) -> str:
        body = self.json(self.call("GET", f"/api/sim/{SEEDED_SIM}"))
        p = validate(
            SimPayload,
            {k: v for k, v in body.items() if k in SimPayload.model_fields},
            "seeded sim",
        )
        self.s["seeded_params"] = {k: v.default for k, v in p.params.items()}
        return f"{len(p.params)} sliders, {len(p.default_output.series)} series"

    def sim_seeded_run(self) -> str:
        params = self.need("seeded_params", "seeded GET did not pass")
        out = self._run_sim(SEEDED_SIM, params)
        return f"{len(out.series)} series, {len(out.series[0].x)} points"

    def paper_ingest(self) -> str:
        body = self.json(self.call("POST", "/api/ingest/paper", data={"arxiv_id": ARXIV_ID}))
        if "method_text" not in body and body.get("job_id"):
            rid = self.follow_job(body["job_id"])
            body = self.json(self.call("GET", f"/api/papers/{rid}")) if rid else body
        text = body.get("method_text") or ""
        if len(text) < 200:
            raise StepFail(f"method_text too short ({len(text)} chars)")
        self.s["paper"] = {"paper_id": body.get("paper_id"), "text": text}
        return f"paper_id={body.get('paper_id')} method_text={len(text)} chars"

    def sim_generate(self) -> str:
        req: dict[str, Any] = {"hint": SIM_HINT}
        paper = self.s.get("paper")
        if paper:
            req["paper_text"] = paper["text"][:20000]
        else:
            req["arxiv_id"] = ARXIV_ID
        body = self.json(self.call("POST", "/api/sim/generate", json=req))
        sim_id = find_key(body, "sim_id")
        if not sim_id:
            raise StepFail("generate response has no `sim_id`")
        params = self._payload_params(body, "generated sim")
        default_output = find_key(body, "default_output")
        if default_output is not None:
            validate(SimOutput, default_output, "generated default_output")
        self.s["gen"] = {"sim_id": sim_id, "params": params}
        return f"sim_id={sim_id} sliders={list(params)}"

    def _run_sim(self, sim_id: str, params: dict[str, float]) -> SimOutput:
        body = self.json(
            self.call("POST", "/api/sim/run", json={"sim_id": sim_id, "params": params})
        )
        candidates = [body] + [find_key(body, k) for k in ("output", "result", "default_output")]
        err: StepFail | None = None
        for cand in candidates:
            if not isinstance(cand, dict):
                continue
            try:
                return validate(SimOutput, cand, "sim run output")
            except StepFail as e:
                err = err or e
        raise err or StepFail("run response has no SimOutput")

    def sim_run_default(self) -> str:
        gen = self.need("gen", "no generated sim (sim.generate did not pass)")
        defaults = {k: v.default for k, v in gen["params"].items()}
        out = self._run_sim(gen["sim_id"], defaults)
        self.s["gen_default_out"] = out
        return f"{len(out.series)} series, {len(out.series[0].x)} points at defaults"

    def sim_run_extreme(self) -> str:
        gen = self.need("gen", "no generated sim (sim.generate did not pass)")
        specs: dict[str, ParamSpec] = gen["params"]
        key = next((k for k in specs if "damp" in k.lower() or k.lower() == "r"), next(iter(specs)))
        spec = specs[key]
        value = spec.max if spec.default < spec.max else spec.min
        params = {k: v.default for k, v in specs.items()} | {key: value}
        out = self._run_sim(gen["sim_id"], params)
        return f"{key}={value:g}: {len(out.series)} series, {len(out.series[0].x)} points"

    # -- ask ----------------------------------------------------------------------
    def ask(self) -> str:
        graph: Graph | None = self.s.get("graph")
        note = ""
        if graph is None:  # lecture ingest unavailable: fall back to the seeded demo graph
            r = self.client.get("/api/graphs/g_demo_lecture")
            if r.status_code == 200:
                graph = Graph.model_validate(r.json())
                note = " (seeded demo graph)"
        node = graph.nodes[0] if graph else None
        import base64

        req = AskSpatialRequest(
            transcript="What does this part mean, and why does it matter?",
            cropped_image_base64=base64.b64encode(self.assets.circle_png).decode(),
            hit_metadata=HitMetadata(
                node_ids=[node.id] if node else [], bbox=(40.0, 40.0, 150.0, 150.0)
            ),
            active_context=ActiveContext(
                view="lecture", graph_id=graph.graph_id if graph else None
            ),
        )
        body = self.json(self.call("POST", "/api/ask-spatial/v2", json=req.model_dump(mode="json")))
        resp = validate(AskSpatialResponse, body, "ask response")
        if not resp.spoken_answer.strip():
            raise StepFail("empty spoken_answer")
        if graph:  # annotations must point at things that exist
            node_ids = {n.id for n in graph.nodes}
            edge_ids = {e.id for e in graph.edges}
            for seg in resp.segments:
                for a in seg.ui_annotations:
                    if a.type == "pulse_node" and a.id not in node_ids:
                        raise StepFail(f"pulse_node targets unknown node {a.id!r}")
                    if a.type == "highlight_edge" and a.id not in edge_ids:
                        raise StepFail(f"highlight_edge targets unknown edge {a.id!r}")
        n_ann = sum(len(s.ui_annotations) for s in resp.segments)
        return f"{len(resp.segments)} segments, {n_ann} annotations{note}"

    # -- voice --------------------------------------------------------------------
    def tts(self) -> str:
        r = self.call("POST", "/api/tts", json={"text": TTS_TEXT})
        ctype = r.headers.get("content-type", "")
        if ctype.startswith("audio/") or ctype == "application/octet-stream":
            if len(r.content) < 500:
                raise StepFail(f"audio too small ({len(r.content)}B)")
            return f"{ctype} {len(r.content)}B"
        body = self.json(r)
        url = next(
            (body.get(k) for k in ("audio_url", "url", "audio_base64", "audio") if body.get(k)),
            None,
        )
        if not url:
            raise StepFail(f"no audio in JSON response (keys: {sorted(body)})")
        return f"JSON audio ref ({len(str(url))} chars)"


def _err(r: httpx.Response) -> str:
    try:
        e = r.json().get("error") or r.json()
        return one_line(f"{e.get('code', '')} {e.get('message', e)}")
    except Exception:  # noqa: BLE001
        return one_line(r.text[:200] or "(empty body)")


# ------------------------------------------------------------------------------ runner
AppFactory = Callable[[bool], FastAPI]  # offline? -> app


def default_factory(offline: bool) -> FastAPI:
    from app.main import create_app
    from app.settings import Settings

    return create_app(Settings(cache_mode="offline")) if offline else create_app()


def run_once(app: FastAPI, args: argparse.Namespace, assets: Assets) -> dict[str, Any]:
    n0 = NET.n
    with TestClient(app, raise_server_exceptions=False) as client:
        smoke = Smoke(client, args, assets)
        results = smoke.run()
    cache = getattr(getattr(app.state, "container", None), "cache", None)
    return {
        "results": results,
        "routes": smoke.route_report,
        "net_total": NET.n - n0,
        "cache_type": type(cache).__name__ if cache is not None else None,
    }


def print_table(title: str, run: dict[str, Any]) -> None:
    results: list[StepResult] = run["results"]
    print(f"\n=== {title} ===")
    print(f"{'STEP':<24}{'STATUS':<22}{'TIME':>8} {'NET':>4}  DETAIL")
    for r in results:
        print(
            f"{r.name:<24}{r.label:<22}{r.latency_s:>7.2f}s {r.net:>4}  {one_line(r.detail, 110)}"
        )
    counts = {s: sum(1 for r in results if r.status == s) for s in ("PASS", "FAIL", "SKIP")}
    total = sum(r.latency_s for r in results)
    print(
        f"-- {counts['PASS']} pass, {counts['FAIL']} fail, {counts['SKIP']} skip "
        f"in {total:.1f}s; outbound HTTP requests: {run['net_total']}"
    )


def print_routes(report: dict[str, Any]) -> None:
    if not report:
        return
    print("\nRoute inventory (expected by lane):")
    for line in report["present"]:
        print(f"  ok       {line}")
    for line in report["missing"]:
        print(f"  MISSING  {line}")


def offline_replay(
    live: dict[str, Any], factory: AppFactory, args: argparse.Namespace, assets: Assets
) -> dict[str, Any]:
    live_pass = [r for r in live["results"] if r.status == "PASS" and r.group != "health"]
    if live["cache_type"] in (None, "MemoryCacheStore"):
        return {
            "verdict": "SKIP",
            "reason": f"no persistent cache in this tree "
            f"(cache is {live['cache_type']}); nothing can be served from cache",
        }
    if not live_pass:
        return {"verdict": "SKIP", "reason": "no live step passed; nothing to replay"}
    run = run_once(factory(True), args, assets)
    by_name = {r.name: r for r in run["results"]}
    misses = [
        f"{r.name}: {by_name[r.name].label} {one_line(by_name[r.name].detail, 80)}"
        for r in live_pass
        if r.name in by_name and by_name[r.name].status != "PASS"
    ]
    problems = misses + (
        [f"{run['net_total']} outbound HTTP request(s) in offline mode"] if run["net_total"] else []
    )
    return {
        "verdict": "FAIL" if problems else "PASS",
        "problems": problems,
        "replayed": len(live_pass),
        "run": run,
    }


def _run_json(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "steps": [asdict(r) | {"label": r.label} for r in run["results"]],
        "routes": run["routes"],
        "outbound_http_requests": run["net_total"],
    }


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--only", help=f"comma-separated groups to run: {','.join(GROUPS[1:])}")
    p.add_argument("--skip-topic", action="store_true", help="skip the (slowest) topic step")
    p.add_argument("--skip-voice", action="store_true", help="skip the TTS step")
    p.add_argument("--json", metavar="PATH", help="also write the full report as JSON")
    p.add_argument(
        "--offline-replay",
        action="store_true",
        help="re-run with cache_mode=offline and require zero live calls",
    )
    args = p.parse_args(argv)
    if args.only:
        bad = set(args.only.split(",")) - set(GROUPS)
        if bad:
            p.error(f"unknown group(s) in --only: {', '.join(sorted(bad))}")
    return args


def main(argv: list[str] | None = None, app_factory: AppFactory | None = None) -> int:
    args = parse_args(argv)
    factory = app_factory or default_factory
    NET.install()
    assets = Assets()

    live = run_once(factory(False), args, assets)
    print_table("LIVE RUN", live)
    print_routes(live["routes"])

    replay: dict[str, Any] | None = None
    if args.offline_replay:
        replay = offline_replay(live, factory, args, assets)
        if "run" in replay:
            print_table("OFFLINE REPLAY (cache_mode=offline)", replay["run"])
        detail = (
            replay.get("reason")
            or "; ".join(replay.get("problems") or [])
            or (f"{replay.get('replayed')} steps served from cache, 0 live calls")
        )
        print(f"\nOFFLINE REPLAY: {replay['verdict']} - {detail}")

    failed = [r for r in live["results"] if r.status == "FAIL"]
    ok = not failed and (replay is None or replay["verdict"] != "FAIL")
    print(
        f"\nOVERALL: {'PASS' if ok else 'FAIL'}"
        + (
            f" ({len(failed)} failed step(s): {', '.join(r.name for r in failed)})"
            if failed
            else ""
        )
    )

    if args.json:
        report = {
            "ok": ok,
            **_run_json(live),
            "offline_replay": None
            if replay is None
            else {
                **{k: v for k, v in replay.items() if k != "run"},
                **({"run": _run_json(replay["run"])} if "run" in replay else {}),
            },
        }
        Path(args.json).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"report written to {args.json}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
