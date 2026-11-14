import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tutor.router import get_store, tutor_router
from tutor.store import make_store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    store = make_store()
    app = FastAPI()
    app.include_router(tutor_router)
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
    return client.get("/api/tutor/tracks").json()[0]["track_id"]


def new_lesson(client):
    s = client.app.dependency_overrides[get_store]()
    return s.create_lesson(track_id(client), "kenji-visual").lesson_id


def test_tutors_and_seed_track(client):
    assert len(client.get("/api/tutor/tutors").json()) == 3
    assert client.get("/api/tutor/tracks").json()[0]["title"] == "Gradient Descent"


def test_create_track_and_get_with_lessons(client):
    t = client.post("/api/tutor/tracks", json={"title": "Linear Algebra"}).json()
    body = client.get(f"/api/tutor/tracks/{t['track_id']}").json()
    assert body["track"]["title"] == "Linear Algebra" and body["lessons"] == []
    assert client.get("/api/tutor/tracks/nope").status_code == 404


def test_materials_prefix_and_empty(client):
    tid = client.post("/api/tutor/tracks", json={"title": "X"}).json()["track_id"]
    url = f"/api/tutor/tracks/{tid}/materials"
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
    r = client.post(f"/api/tutor/lessons/{lid}/progress", json={
        "kp_updates": [{"kp_id": "gd1", "status": "introduced", "evidence": "said loss"}],
        "struggles": [{"kp_id": "gd2", "what": "direction", "tried_explanations": ["hill"]}],
        "worked": [{"kp_id": "gd1", "explanation_style": "analogy"}]})
    assert r.status_code == 200
    assert r.json()["struggles"][0]["kp_id"] == "gd2" and r.json()["worked"][0]["kp_id"] == "gd1"
    kp = next(k for k in client.get(f"/api/tutor/tracks/{tid}").json()["track"]["knowledge_points"] if k["kp_id"] == "gd1")
    assert kp["status"] == "introduced" and kp["evidence"] == "said loss"


def test_progress_unknown_kp_404(client):
    lid = new_lesson(client)
    r = client.post(f"/api/tutor/lessons/{lid}/progress",
                    json={"kp_updates": [{"kp_id": "zzz", "status": "introduced", "evidence": ""}]})
    assert r.status_code == 404 and "zzz" in r.json()["detail"]


def test_end_is_idempotent(client):
    lid = new_lesson(client)
    body = {"summary": "s", "covered_kp_ids": ["gd1"]}
    a = client.post(f"/api/tutor/lessons/{lid}/end", json=body).json()
    b = client.post(f"/api/tutor/lessons/{lid}/end", json={**body, "summary": "changed"}).json()
    assert a["ended_at"] and a["ended_at"] == b["ended_at"] and b["summary"] == "s"


def test_context_bundle(client):
    lid = new_lesson(client)
    ctx = client.get(f"/api/tutor/context/{lid}").json()
    assert set(ctx) == {"tutor", "profile", "track", "recent_lessons"}
    assert client.get("/api/tutor/context/nope").status_code == 404
