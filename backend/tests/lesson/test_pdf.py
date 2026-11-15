import pymupdf
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.lesson import deck as decks
from app.modules.lesson import pdf
from app.modules.lesson.router import get_deck_llm, get_store, tutor_router
from app.modules.lesson.store import make_store

from tests.lesson.test_deck import FakeLLM, tiny_deck, tool_reply

PAGES = [
    "Differentiation notes\nThe gradient of a straight line is rise over run.\nFor y = 3x + 1 the gradient is 3.",
    "Chords on a curve\nA chord joins (1, 1) and (3, 9) on y = x^2.\nIts gradient is (9 - 1) / (3 - 1) = 4.",
    "First principles\nThe chord from x to x + h has gradient 2x + h.\nAs h tends to 0 the gradient of y = x^2 is 2x.",
]


def make_pdf(pages=PAGES) -> bytes:
    doc = pymupdf.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text)
    return doc.tobytes()


def kp_reply(n=5):
    kps = [{"id": f"k{i}", "title": f"Idea {i}", "summary": f"Summary {i}",
            "prereq_ids": [f"k{i - 1}", "nope"] if i > 1 else []} for i in range(1, n + 1)]
    return {"content": [{"type": "tool_use", "id": "t1", "name": "make_knowledge_points",
                         "input": {"title": "Differentiation", "knowledge_points": kps}}]}


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    store = make_store()
    llm = FakeLLM()
    app = FastAPI()
    app.include_router(tutor_router, prefix="/api")
    app.dependency_overrides[get_store] = lambda: store
    app.dependency_overrides[get_deck_llm] = lambda: llm
    client = TestClient(app)
    tid = client.post("/api/lesson/tracks", json={"title": "Diff"}).json()["track_id"]
    return client, store, llm, tid


def upload(client, tid, data, name="notes.pdf"):
    return client.post(f"/api/lesson/tracks/{tid}/materials/pdf", files={"file": (name, data, "application/pdf")})


def test_upload_stores_text_material_and_llm_kps(env):
    client, store, llm, tid = env
    llm.replies.append(kp_reply())
    r = upload(client, tid, make_pdf())
    assert r.status_code == 200
    t = r.json()
    assert t["materials"] == [{"kind": "pdf", "ref": "notes.pdf", "dataset_title": "Differentiation"}]
    kps = t["knowledge_points"]
    assert [k["kp_id"] for k in kps] == [f"m0:k{i}" for i in range(1, 6)]
    assert kps[1]["prereq_ids"] == ["m0:k1"]  # unknown prereqs dropped
    doc = store.get_material_text(tid, "m0")
    assert len(doc["pages"]) == 3 and "(9 - 1) / (3 - 1) = 4" in doc["pages"][1]
    body = llm.bodies[0]
    assert body["model"] == decks.MODEL and body["tool_choice"] == {"type": "auto"}
    assert "As h tends to 0" in body["messages"][0]["content"]  # the model saw the full text, not just headings
    assert store.get_track(tid).knowledge_points[0].kp_id == "m0:k1"


def test_second_upload_gets_next_prefix(env):
    client, store, llm, tid = env
    llm.replies += [kp_reply(), kp_reply(6)]
    upload(client, tid, make_pdf())
    t = upload(client, tid, make_pdf(), "b.pdf").json()
    assert len(t["materials"]) == 2 and t["knowledge_points"][-1]["kp_id"] == "m1:k6"
    assert store.get_material_text(tid, "m1")["filename"] == "b.pdf"


def test_llm_failure_falls_back_to_headings(env):
    client, _, llm, tid = env
    llm.replies.append(RuntimeError("API down"))
    t = upload(client, tid, make_pdf()).json()
    assert [k["title"] for k in t["knowledge_points"]] == ["Differentiation notes", "Chords on a curve", "First principles"]
    assert t["knowledge_points"][2]["prereq_ids"] == ["m0:k2"]
    assert t["materials"][0]["dataset_title"] == "notes.pdf"


def test_invalid_tool_input_falls_back(env):
    client, _, llm, tid = env
    llm.replies.append({"content": [{"type": "tool_use", "id": "t", "input": {"knowledge_points": []}}]})
    assert len(upload(client, tid, make_pdf()).json()["knowledge_points"]) == 3


def test_errors(env, monkeypatch):
    client, store, llm, tid = env
    assert upload(client, tid, b"hello, not a pdf", "x.pdf").status_code == 415
    r = upload(client, tid, make_pdf(["", ""]))
    assert r.status_code == 422 and "scanned" in r.json()["detail"]
    monkeypatch.setattr(pdf, "MAX_BYTES", 100)
    assert upload(client, tid, make_pdf()).status_code == 413
    monkeypatch.setattr(pdf, "MAX_BYTES", 20 * 1024 * 1024)
    monkeypatch.setattr(pdf, "MAX_PAGES", 2)
    assert upload(client, tid, make_pdf()).status_code == 413
    assert upload(client, "nope", make_pdf()).status_code == 404
    assert store.get_track(tid).materials == [] and llm.bodies == []


def test_deck_prompt_uses_pdf_text(env):
    client, store, llm, tid = env
    llm.replies.append(kp_reply())
    upload(client, tid, make_pdf())
    kp_ids = [k.kp_id for k in store.get_track(tid).knowledge_points]
    llm.replies.append(tool_reply(tiny_deck(kp_ids)))
    client.post(f"/api/lesson/tracks/{tid}/deck")
    prompt = llm.bodies[1]["messages"][0]["content"]
    assert "A chord joins (1, 1) and (3, 9)" in prompt and "As h tends to 0" in prompt
    assert client.get(f"/api/lesson/tracks/{tid}/deck").json()["status"] == "ready"


def test_pdf_excerpt_keeps_kp_pages_in_order():
    pages = ["filler " * 50, "chords gradient secant " * 5, "filler " * 50, "tangent limit " * 5]
    out = decks.pdf_excerpt(pages, ["Gradient of a chord", "Tangent as a limit"], budget=300)
    assert "[page 2]" in out and "[page 4]" in out and "[page 1]" not in out
    assert out.index("[page 2]") < out.index("[page 4]")
    assert decks.pdf_excerpt(["short"], []) == "[page 1]\nshort"
