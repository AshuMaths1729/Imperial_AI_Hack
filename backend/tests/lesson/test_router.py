import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.lesson.router import get_store, tutor_router
from app.modules.lesson.store import make_store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    store = make_store()
    app = FastAPI()
    app.include_router(tutor_router, prefix="/api")
    app.dependency_overrides[get_store] = lambda: store
    return TestClient(app)


def dataset(nodes=("n1", "n2")):
    return {
        "mode": "lecture", "title": "T", "subtitle": "s",
        "nodes": [{"id": n, "label": f"L{n}", "summary": f"S{n}"} for n in nodes],
        "edges": [{"id": "e1", "source": "n1", "target": "n2", "type": "prerequisite"},
                  {"id": "e2", "source": "n2", "target": "n1", "type": "supports"}] if nodes else [],
    }


def track_id(client):
    # the gd* knowledge points these tests use belong to the Gradient Descent seed track
    return next(t["track_id"] for t in client.get("/api/lesson/tracks").json() if t["track_id"] == "gradient-descent")


def new_lesson(client):
    s = client.app.dependency_overrides[get_store]()
    return s.create_lesson(track_id(client), "kenji-visual").lesson_id


def test_tutors_and_seed_track(client):
    assert len(client.get("/api/lesson/tutors").json()) == 3
    assert [t["track_id"] for t in client.get("/api/lesson/tracks").json()][:2] == ["differentiation", "gradient-descent"]


def test_create_track_and_get_with_lessons(client):
    t = client.post("/api/lesson/tracks", json={"title": "Linear Algebra"}).json()
    body = client.get(f"/api/lesson/tracks/{t['track_id']}").json()
    assert body["track"]["title"] == "Linear Algebra" and body["lessons"] == []
    assert client.get("/api/lesson/tracks/nope").status_code == 404


def test_materials_prefix_and_empty(client):
    tid = client.post("/api/lesson/tracks", json={"title": "X"}).json()["track_id"]
    url = f"/api/lesson/tracks/{tid}/materials"
    client.post(url, json={"kind": "pdf", "ref": "a.pdf", "dataset": dataset()})
    t = client.post(url, json={"kind": "pdf", "ref": "b.pdf", "dataset": dataset()}).json()
    kps = {k["kp_id"]: k for k in t["knowledge_points"]}
    assert {"m0:n1", "m1:n1"} <= set(kps)
    assert kps["m0:n2"]["prereq_ids"] == ["m0:n1"]  # only 'prerequisite' edges count
    assert kps["m0:n1"]["prereq_ids"] == []
    assert kps["m1:n2"]["title"] == "Ln2"
    n = len(t["knowledge_points"])
    t = client.post(url, json={"kind": "url", "ref": "c", "dataset": dataset(nodes=())})
    assert t.status_code == 200
    assert len(t.json()["knowledge_points"]) == n
    assert len(t.json()["materials"]) == 3


def test_progress_updates_kp_status(client):
    lid, tid = new_lesson(client), track_id(client)
    r = client.post(f"/api/lesson/lessons/{lid}/progress", json={
        "kp_updates": [{"kp_id": "gd1", "status": "introduced", "evidence": "said loss"}],
        "struggles": [{"kp_id": "gd2", "what": "direction", "tried_explanations": ["hill"]}],
        "worked": [{"kp_id": "gd1", "explanation_style": "analogy"}]})
    assert r.status_code == 200
    assert r.json()["struggles"][0]["kp_id"] == "gd2" and r.json()["worked"][0]["kp_id"] == "gd1"
    kp = next(k for k in client.get(f"/api/lesson/tracks/{tid}").json()["track"]["knowledge_points"] if k["kp_id"] == "gd1")
    assert kp["status"] == "introduced" and kp["evidence"] == "said loss"


def test_progress_unknown_kp_404(client):
    lid = new_lesson(client)
    r = client.post(f"/api/lesson/lessons/{lid}/progress",
                    json={"kp_updates": [{"kp_id": "zzz", "status": "introduced", "evidence": ""}]})
    assert r.status_code == 404 and "zzz" in r.json()["detail"]


def test_end_is_idempotent(client):
    lid = new_lesson(client)
    body = {"summary": "s", "covered_kp_ids": ["gd1"]}
    a = client.post(f"/api/lesson/lessons/{lid}/end", json=body).json()
    b = client.post(f"/api/lesson/lessons/{lid}/end", json={**body, "summary": "changed"}).json()
    assert a["ended_at"] and a["ended_at"] == b["ended_at"] and b["summary"] == "s"


def test_context_bundle(client):
    lid = new_lesson(client)
    ctx = client.get(f"/api/lesson/context/{lid}").json()
    assert set(ctx) == {"tutor", "profile", "track", "recent_lessons", "resume"}
    assert ctx["resume"] is None
    assert client.get("/api/lesson/context/nope").status_code == 404


STATE = {
    "slide": 3, "step": 2, "idea": "A chord's gradient is rise over run.",
    "detours": [{"topic": "limits", "why": "asked", "from_slide": 3, "from_step": 2, "from_idea": "chords"}],
    "concepts": [{"concept": "gradient", "level": "got_it", "evidence": "said 2", "anchor": "speedometer", "tries": 0}],
    "text": "Lesson state: ...",
}


def test_state_roundtrip(client):
    lid = new_lesson(client)
    assert client.get(f"/api/lesson/lessons/{lid}/state").json() is None
    saved = client.post(f"/api/lesson/lessons/{lid}/state", json=STATE).json()
    assert saved["saved_at"] and saved["slide"] == 3
    got = client.get(f"/api/lesson/lessons/{lid}/state").json()
    assert got == saved and got["concepts"][0]["anchor"] == "speedometer"
    newer = client.post(f"/api/lesson/lessons/{lid}/state", json={**STATE, "step": 3}).json()
    assert client.get(f"/api/lesson/lessons/{lid}/state").json()["step"] == 3 and newer["step"] == 3


def test_state_is_validated(client):
    lid = new_lesson(client)
    url = f"/api/lesson/lessons/{lid}/state"
    bad_level = {**STATE, "concepts": [{"concept": "x", "level": "kinda"}]}
    assert client.post(url, json=bad_level).status_code == 422
    assert client.post(url, json={**STATE, "slide": "three"}).status_code == 422
    assert client.post(url, json={**STATE, "text": "x" * 5000}).status_code == 422
    assert client.post("/api/lesson/lessons/nope/state", json=STATE).status_code == 404
    assert client.get("/api/lesson/lessons/nope/state").status_code == 404


def test_state_does_not_unend_or_change_the_lesson(client):
    lid = new_lesson(client)
    client.post(f"/api/lesson/lessons/{lid}/end", json={"summary": "s"})
    client.post(f"/api/lesson/lessons/{lid}/state", json=STATE)  # a late checkpoint after /end
    lesson = client.app.dependency_overrides[get_store]().get_lesson(lid)
    assert lesson.ended_at and lesson.summary == "s" and lesson.state.slide == 3


def test_new_lesson_resumes_from_the_previous_lessons_state(client):
    first = new_lesson(client)
    client.post(f"/api/lesson/lessons/{first}/state", json=STATE)
    client.post(f"/api/lesson/lessons/{first}/end", json={"summary": "did chords"})
    second = new_lesson(client)
    ctx = client.get(f"/api/lesson/context/{second}").json()
    assert ctx["recent_lessons"][0]["state"]["slide"] == 3
    assert ctx["resume"]["slide"] == 3 and ctx["resume"]["lesson_id"] == first


def test_resume_survives_a_lesson_that_never_ended(client):
    crashed = new_lesson(client)  # the worker died before /end: its checkpoint still resumes
    client.post(f"/api/lesson/lessons/{crashed}/state", json={**STATE, "slide": 5})
    later = new_lesson(client)
    client.post(f"/api/lesson/lessons/{later}/state", json={**STATE, "slide": 6})
    current = new_lesson(client)
    resume = client.get(f"/api/lesson/context/{current}").json()["resume"]
    assert resume["slide"] == 6 and resume["lesson_id"] == later
    # the current lesson's own checkpoint is never its resume point
    client.post(f"/api/lesson/lessons/{current}/state", json={**STATE, "slide": 1})
    assert client.get(f"/api/lesson/context/{current}").json()["resume"]["slide"] == 6
