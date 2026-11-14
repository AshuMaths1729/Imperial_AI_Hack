import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tutor.router import get_store, tutor_router
from tutor.store import make_store


class SlowReads:
    """Store proxy: every get_lesson/get_track returns, then sleeps, widening the read-modify-write window."""

    def __init__(self, store, delay=0.2):
        self._s, self._d = store, delay

    def __getattr__(self, name):
        attr = getattr(self._s, name)
        if name not in ("get_lesson", "get_track"):
            return attr

        def slow(*a, **k):
            out = attr(*a, **k)
            time.sleep(self._d)
            return out
        return slow


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    store = make_store()
    app = FastAPI()
    app.include_router(tutor_router)
    app.dependency_overrides[get_store] = lambda: SlowReads(store)
    return TestClient(app), store


def test_late_progress_does_not_unend_lesson(env):
    client, store = env
    lid = store.create_lesson("gradient-descent", "kenji-visual").lesson_id
    with ThreadPoolExecutor(2) as ex:
        p = ex.submit(client.post, f"/api/tutor/lessons/{lid}/progress",
                      json={"worked": [{"kp_id": "gd1", "explanation_style": "analogy"}]})
        time.sleep(0.05)  # progress has read the lesson, not yet saved
        e = ex.submit(client.post, f"/api/tutor/lessons/{lid}/end", json={"summary": "done", "covered_kp_ids": ["gd1"]})
        p.result(), e.result()
    lesson = store.get_lesson(lid)
    assert lesson.ended_at and lesson.summary == "done"
    assert len(lesson.worked) == 1


def test_concurrent_end_keeps_single_ended_at(env):
    client, store = env
    lid = store.create_lesson("gradient-descent", "kenji-visual").lesson_id
    with ThreadPoolExecutor(2) as ex:
        rs = [ex.submit(client.post, f"/api/tutor/lessons/{lid}/end", json={"summary": s, "covered_kp_ids": []})
              for s in ("a", "b")]
        a, b = [r.result().json() for r in rs]
    assert a["ended_at"] == b["ended_at"] and a["summary"] == b["summary"]


def test_concurrent_materials_get_distinct_prefixes(env):
    client, store = env
    ds = {"mode": "lecture", "title": "T", "subtitle": "s",
          "nodes": [{"id": "n1", "label": "L", "summary": "S"}], "edges": []}
    with ThreadPoolExecutor(2) as ex:
        rs = [ex.submit(client.post, "/api/tutor/tracks/gradient-descent/materials",
                        json={"kind": "pdf", "ref": r, "dataset": ds}) for r in ("a", "b")]
        [r.result() for r in rs]
    t = store.get_track("gradient-descent")
    ids = [k.kp_id for k in t.knowledge_points]
    assert len(t.materials) == 3 and "m1:n1" in ids and "m2:n1" in ids
