from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from schemas import WorkspaceDataset

from .models import KP, Lesson, Material, Struggle, Track, Worked
from .store import Store, make_store

tutor_router = APIRouter(prefix="/api/tutor")

_store: Optional[Store] = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = make_store()
    return _store


def _lookup(fn, key):
    try:
        return fn(key)
    except KeyError as e:
        raise HTTPException(404, e.args[0])


class NewTrack(BaseModel):
    title: str
    user_id: str = "demo"


class MaterialIn(BaseModel):
    kind: Literal["pdf", "url", "demo"]
    ref: str
    dataset: WorkspaceDataset


class KPUpdate(BaseModel):
    kp_id: str
    status: Literal["not_started", "introduced", "understood"]
    evidence: str = ""


class ProgressIn(BaseModel):
    kp_updates: List[KPUpdate] = []
    struggles: List[Struggle] = []
    worked: List[Worked] = []


class EndIn(BaseModel):
    summary: str
    covered_kp_ids: List[str] = []
    board_snapshot_ref: Optional[str] = None


@tutor_router.get("/tutors")
def list_tutors(store: Store = Depends(get_store)):
    return store.list_tutors()


@tutor_router.get("/tracks")
def list_tracks(user_id: str = "demo", store: Store = Depends(get_store)):
    return store.list_tracks(user_id)


@tutor_router.post("/tracks")
def create_track(body: NewTrack, store: Store = Depends(get_store)):
    now = datetime.now(timezone.utc)
    track = Track(track_id=f"t{int(now.timestamp() * 1000)}", user_id=body.user_id,
                  title=body.title, created_at=now.isoformat())
    store.save_track(track)
    return track


@tutor_router.get("/tracks/{track_id}")
def get_track(track_id: str, store: Store = Depends(get_store)):
    track = _lookup(store.get_track, track_id)
    return {"track": track, "lessons": store.recent_lessons(track_id, 3)}


@tutor_router.post("/tracks/{track_id}/materials")
def add_material(track_id: str, body: MaterialIn, store: Store = Depends(get_store)):
    track = _lookup(store.get_track, track_id)
    prefix = f"m{len(track.materials)}"
    prereqs: dict = {}
    for e in body.dataset.edges:
        if e.type == "prerequisite":
            prereqs.setdefault(e.target, []).append(f"{prefix}:{e.source}")
    track.materials.append(Material(kind=body.kind, ref=body.ref, dataset_title=body.dataset.title))
    track.knowledge_points += [
        KP(kp_id=f"{prefix}:{n.id}", title=n.label, summary=n.summary, prereq_ids=prereqs.get(n.id, []))
        for n in body.dataset.nodes
    ]
    store.save_track(track)
    return track


@tutor_router.get("/context/{lesson_id}")
def get_context(lesson_id: str, store: Store = Depends(get_store)):
    lesson = _lookup(store.get_lesson, lesson_id)
    track = _lookup(store.get_track, lesson.track_id)
    return {
        "tutor": _lookup(store.get_tutor, lesson.tutor_id),
        "profile": _lookup(store.get_profile, track.user_id),
        "track": track,
        "recent_lessons": store.recent_lessons(track.track_id, 3),
    }


@tutor_router.post("/lessons/{lesson_id}/progress")
def post_progress(lesson_id: str, body: ProgressIn, store: Store = Depends(get_store)) -> Lesson:
    lesson = _lookup(store.get_lesson, lesson_id)
    track = _lookup(store.get_track, lesson.track_id)
    kps = {k.kp_id: k for k in track.knowledge_points}
    for u in body.kp_updates:  # validate everything before writing anything
        if u.kp_id not in kps:
            raise HTTPException(404, f"unknown kp_id: {u.kp_id}")
    for u in body.kp_updates:
        kps[u.kp_id].status, kps[u.kp_id].evidence = u.status, u.evidence
    lesson.struggles += body.struggles
    lesson.worked += body.worked
    store.save_track(track)
    store.save_lesson(lesson)
    return lesson


@tutor_router.post("/lessons/{lesson_id}/end")
def end_lesson(lesson_id: str, body: EndIn, store: Store = Depends(get_store)) -> Lesson:
    lesson = _lookup(store.get_lesson, lesson_id)
    if lesson.ended_at:
        return lesson
    lesson.ended_at = datetime.now(timezone.utc).isoformat()
    lesson.summary = body.summary
    lesson.covered_kp_ids = body.covered_kp_ids
    lesson.board_snapshot_ref = body.board_snapshot_ref
    store.save_lesson(lesson)
    return lesson
