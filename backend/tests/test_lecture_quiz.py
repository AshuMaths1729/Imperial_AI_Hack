"""Lecture ingest + graph/doc reads + quiz/mastery flow. No live calls (FakeLLM)."""

from __future__ import annotations

import base64

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.deps import get_llm
from app.llm.testing import FakeLLM
from app.main import create_app
from app.modules.lecture.drafts import LectureDraft
from app.modules.lecture.service import draft_to_graph
from app.schemas.graph import Graph, find_prerequisite_cycle
from app.settings import Settings

DRAFT = {
    "concepts": [
        {"label": "Gradient Descent", "summary": "Iteratively follow the negative gradient.",
         "page": 1, "aliases": ["GD"]},
        {"label": "Learning Rate", "summary": "Step size.", "page": 2},
        {"label": "Loss Function", "summary": "Measures error.", "page": 0},  # clamped to 1
        {"label": "gradient descent!", "page": 3,  # merged by normalised label
         "summary": "A much longer duplicate summary text that wins the merge."},
        {"label": "Momentum", "summary": "Accumulates past gradients.", "page": 99},  # clamped
    ],
    "prerequisites": [
        {"prerequisite": "Loss Function", "dependent": "Gradient Descent"},
        {"prerequisite": "Gradient Descent", "dependent": "Learning Rate"},
        {"prerequisite": "Learning Rate", "dependent": "Loss Function"},  # closes a cycle
        {"prerequisite": "GD", "dependent": "Momentum"},  # alias resolves
        {"prerequisite": "GD", "dependent": "Momentum"},  # duplicate
        {"prerequisite": "Momentum", "dependent": "Momentum"},  # self-loop
        {"prerequisite": "Momentum", "dependent": "Nonexistent"},  # dangling
    ],
}

QUIZ = {
    "questions": [
        {"question": f"Q{i}?", "options": ["a", "b", "c", "d"], "correct_index": i,
         "explanation": f"because {i}"}
        for i in range(3)
    ]
}


def make_pdf(pages: int = 3) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"Slide {i + 1}: gradient descent topic {i}")
    return doc.tobytes()


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def lc(tmp_path, fake_llm):
    settings = Settings(
        _env_file=None, state_dir=tmp_path / "state", fixtures_dir=tmp_path / "fixtures"
    )
    app = create_app(settings)
    app.dependency_overrides[get_llm] = lambda: fake_llm
    with TestClient(app) as c:
        yield c


def ingest(lc, pdf: bytes, **params):
    return lc.post(
        "/api/ingest/lecture",
        files={"file": ("lec.pdf", pdf, "application/pdf")},
        params=params,
    )


def test_draft_to_graph_hygiene():
    g = draft_to_graph(LectureDraft.model_validate(DRAFT), "abc123abc123", page_count=3)
    assert g.kind == "lecture" and g.graph_id == "g_abc123abc123"
    assert g.meta.extractor_used == "frontier"
    labels = [n.label for n in g.nodes]
    assert labels == ["Gradient Descent", "Learning Rate", "Loss Function", "Momentum"]
    pages = {n.label: n.source_ref.page for n in g.nodes}
    assert pages == {"Gradient Descent": 1, "Learning Rate": 2, "Loss Function": 1, "Momentum": 3}
    assert g.nodes[0].summary == "A much longer duplicate summary text that wins the merge."
    assert find_prerequisite_cycle(g) is None
    # 3-cycle lost exactly one edge; alias edge kept once; self-loop/dangling dropped
    assert len(g.edges) == 3
    assert all(e.type == "prerequisite" for e in g.edges)
    assert {n.id[:2] for n in g.nodes} == {"n_"}


def test_ingest_graph_valid_and_stable_ids(lc, fake_llm):
    pdf = make_pdf()
    fake_llm.queue("lecture.extract", DRAFT, DRAFT)
    r = ingest(lc, pdf)
    assert r.status_code == 200, r.text
    body = r.json()
    graph = Graph.model_validate(body["graph"])
    assert body["graph_id"] == graph.graph_id == f"g_{body['doc_id']}"
    assert find_prerequisite_cycle(graph) is None
    assert body["page_count"] == 3 and body["truncated"] is False

    # the PDF went to the model first, as a base64 document block
    call = fake_llm.calls[0]
    assert call.route == "lecture.extract"
    assert call.content[0]["type"] == "document"
    assert call.content[0]["source"]["data"] == base64.b64encode(pdf).decode()
    assert call.content[1]["type"] == "text"

    # re-extraction (force) produces identical ids
    again = ingest(lc, pdf, force=True).json()["graph"]
    assert [n["id"] for n in again["nodes"]] == [n["id"] for n in body["graph"]["nodes"]]
    assert [e["id"] for e in again["edges"]] == [e["id"] for e in body["graph"]["edges"]]


def test_reupload_is_idempotent(lc, fake_llm):
    pdf = make_pdf()
    fake_llm.queue("lecture.extract", DRAFT)
    first = ingest(lc, pdf).json()
    second = ingest(lc, pdf).json()  # no second LLM output queued -> must not call the model
    assert len(fake_llm.calls) == 1
    assert second["graph"] == first["graph"]
    assert second["doc_id"] == first["doc_id"]


def test_ingest_rejects_non_pdf(lc):
    r = lc.post("/api/ingest/lecture", files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_upload"


def test_graph_get_and_doc_pages(lc, fake_llm):
    fake_llm.queue("lecture.extract", DRAFT)
    body = ingest(lc, make_pdf()).json()
    gid, did = body["graph_id"], body["doc_id"]

    assert lc.get(f"/api/graphs/{gid}").json() == body["graph"]

    doc = lc.get(f"/api/docs/{did}").json()
    assert doc["page_count"] == 3 and len(doc["pages"]) == 3
    assert "gradient descent" in doc["pages"][0]["snippet"]

    full = lc.get(f"/api/docs/{did}/pages/1.png")
    thumb = lc.get(f"/api/docs/{did}/pages/1.png", params={"size": "thumb"})
    for r in (full, thumb):
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content.startswith(b"\x89PNG")
    assert len(full.content) > len(thumb.content)
    assert lc.get(f"/api/docs/{did}/pages/4.png").status_code == 404
    assert lc.get("/api/docs/000000000000/pages/1.png").status_code == 404
    assert lc.get("/api/docs/..%2f..%2fetc").status_code == 404


def test_graph_fallbacks(lc, tmp_path, fake_llm):
    assert lc.get("/api/graphs/g_nope").status_code == 404
    assert lc.get("/api/graphs/g_demo_lecture").status_code == 404  # no fixture file yet

    fake_llm.queue("lecture.extract", DRAFT)
    graph = Graph.model_validate(ingest(lc, make_pdf()).json()["graph"])
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    demo = graph.model_copy(update={"graph_id": "g_demo_lecture"})
    (fixtures / "lecture_graph.json").write_text(demo.model_dump_json(), encoding="utf-8")
    r = lc.get("/api/graphs/g_demo_lecture")
    assert r.status_code == 200 and r.json()["graph_id"] == "g_demo_lecture"
    assert lc.get("/api/graphs/g_demo_hypothesis").status_code == 404  # fixture still missing


def test_quiz_and_mastery_flow(lc, fake_llm):
    fake_llm.queue("lecture.extract", DRAFT)
    gid = ingest(lc, make_pdf()).json()["graph_id"]
    nodes = lc.get(f"/api/graphs/{gid}").json()["nodes"]
    gd = next(n for n in nodes if n["label"] == "Gradient Descent")

    # nothing answered yet: weakest is the first node in graph order
    nxt = lc.get(f"/api/quiz/{gid}/next").json()
    assert nxt["node_id"] == nodes[0]["id"] and nxt["mastery"] == 0.0

    fake_llm.queue("quiz.gen", QUIZ)
    quiz = lc.get(f"/api/quiz/{gid}/{gd['id']}").json()
    qs = quiz["questions"]
    assert len(qs) == 3 and all(len(q["options"]) == 4 for q in qs)
    # the prompt carried the node, its neighbours and the slide text
    sent = fake_llm.calls[-1].content
    assert "Gradient Descent" in sent and "Loss Function" in sent and "Slide text" in sent

    # cached: a second GET must not call the model again (nothing queued)
    n_calls = len(fake_llm.calls)
    assert lc.get(f"/api/quiz/{gid}/{gd['id']}").json() == quiz
    assert len(fake_llm.calls) == n_calls

    def answer(q, choice):
        return lc.post(
            f"/api/quiz/{gid}/{gd['id']}/answer", json={"question_id": q["id"], "choice": choice}
        ).json()

    right = answer(qs[0], qs[0]["correct_index"])
    assert right["correct"] is True and right["mastery"] == pytest.approx(0.35)
    assert right["explanation"] == qs[0]["explanation"]
    wrong = answer(qs[1], (qs[1]["correct_index"] + 1) % 4)
    assert wrong["correct"] is False and wrong["mastery"] == pytest.approx(0.2275)

    mastery = lc.get(f"/api/mastery/{gid}").json()
    by_id = {e["node_id"]: e for e in mastery["nodes"]}
    assert by_id[gd["id"]]["mastery"] == pytest.approx(0.2275) and by_id[gd["id"]]["attempts"] == 2
    assert len(mastery["nodes"]) == len(nodes)

    # an answered node is no longer the weakest
    assert lc.get(f"/api/quiz/{gid}/next").json()["node_id"] != gd["id"]

    # errors
    bad_q = lc.post(f"/api/quiz/{gid}/{gd['id']}/answer", json={"question_id": "zzz", "choice": 0})
    assert bad_q.status_code == 404
    assert lc.get(f"/api/quiz/{gid}/n_missing").status_code == 404
    assert lc.get("/api/quiz/g_missing/next").status_code == 404
