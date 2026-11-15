import functools
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel


from . import deck as decks
from . import pdf
from .models import KP, Lesson, LessonCheckpoint, Material, Struggle, Track, Worked
from .livekit_token import mint_token
from .store import Store, make_store

# keys: the repo-root .env (main's convention), then backend/.env if present
load_dotenv(Path(__file__).resolve().parents[4] / ".env")
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

tutor_router = APIRouter(prefix="/lesson", tags=["lesson"])  # mounted under /api by app.main: /api/lesson/...

_store: Optional[Store] = None
# Sync endpoints run in a threadpool; read-modify-write endpoints hold this for their whole body.
# shortcut: one global lock, fine for one process; use per-document locks or Mongo atomic updates to scale.
log = logging.getLogger(__name__)
_write_lock = threading.Lock()


def _locked(fn):
    @functools.wraps(fn)
    def wrapper(*a, **k):
        with _write_lock:
            return fn(*a, **k)
    return wrapper


_store_init_lock = threading.Lock()


def get_store() -> Store:
    # Built once under a lock: the lesson page asks for tutors and tracks at the same time, and two
    # concurrent first requests would each build a store and seed the same JSON files (on Windows
    # the second os.replace fails with "Access is denied").
    global _store
    if _store is None:
        with _store_init_lock:
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


class SessionIn(BaseModel):
    track_id: str
    tutor_id: str
    user_id: str = "demo"


class MaterialNode(BaseModel):
    id: str
    label: str
    summary: str = ""


class MaterialEdge(BaseModel):
    source: str
    target: str
    type: str = "prerequisite"


class MaterialDataset(BaseModel):
    """The concept graph of an ingested material (only what a track needs: KPs and their prerequisites)."""
    title: str
    nodes: List[MaterialNode] = []
    edges: List[MaterialEdge] = []


class MaterialIn(BaseModel):
    kind: Literal["pdf", "url", "demo"]
    ref: str
    dataset: MaterialDataset


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


def get_deck_llm() -> decks.LLM:
    """Overridden in tests with a fake Anthropic client."""
    return decks.anthropic_llm


@tutor_router.post("/tracks/{track_id}/materials")
@_locked
def add_material(track_id: str, body: MaterialIn, background: BackgroundTasks, store: Store = Depends(get_store),
                 llm: decks.LLM = Depends(get_deck_llm)):
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
    queue_deck(store, track_id, background, llm)  # the slides build themselves from the new material
    return track


# Key points still being written for a track's PDF uploads: deck generation waits for them (it builds from the KPs).
_pending_kps: dict[str, list[threading.Event]] = {}
_pending_lock = threading.Lock()
KP_WAIT_S = 60.0


def _prefix(kps: List[KP], prefix: str) -> List[KP]:
    for k in kps:  # built with the placeholder prefix "_"
        k.kp_id = prefix + k.kp_id[1:]
        k.prereq_ids = [prefix + p[1:] for p in k.prereq_ids]
    return kps


def _refine_kps(store: Store, track_id: str, prefix: str, pages: List[str], name: str, llm, done: threading.Event) -> None:
    """Background: replace an upload's quick heading KPs with the model's KPs (and its title), then release waiters."""
    try:
        title, kps = pdf.build_kps(pages, name, "_", llm, decks.MODEL)
        with _write_lock:
            track = _lookup(store.get_track, track_id)
            mine = f"{prefix}:"
            old = {k.kp_id: k for k in track.knowledge_points if k.kp_id.startswith(mine)}
            fresh = _prefix(kps, prefix)
            for k in fresh:  # a lesson may already have marked a heading KP with the same id: keep its progress
                if k.kp_id in old:
                    k.status, k.evidence = old[k.kp_id].status, old[k.kp_id].evidence
            track.knowledge_points = [k for k in track.knowledge_points if not k.kp_id.startswith(mine)] + fresh
            for m in track.materials:
                if m.kind == "pdf" and m.ref == name and m.dataset_title == name and title:
                    m.dataset_title = title
            store.save_track(track)
    except Exception:  # never lose the upload over this; the heading KPs stay
        log.exception("background key points failed for %s", name)
    finally:
        done.set()
        with _pending_lock:
            waiting = _pending_kps.get(track_id, [])
            if done in waiting:
                waiting.remove(done)


def wait_for_kps(track_id: str, timeout: float = KP_WAIT_S) -> None:
    with _pending_lock:
        events = list(_pending_kps.get(track_id, []))
    for e in events:
        e.wait(timeout)


@tutor_router.post("/tracks/{track_id}/materials/pdf")
def add_pdf(track_id: str, background: BackgroundTasks, file: UploadFile = File(...), store: Store = Depends(get_store),
            llm: decks.LLM = Depends(get_deck_llm)) -> Track:
    """Full text of the PDF is stored and the Track comes back at once with quick heading KPs; the model's KPs
    (Sonnet) replace them a few seconds later in the background (the upload no longer waits ~5 s for them)."""
    _lookup(store.get_track, track_id)
    try:
        pages = pdf.extract_pages(file.file.read(pdf.MAX_BYTES + 1))
    except pdf.PdfError as e:
        raise HTTPException(e.status, str(e))
    name = file.filename or "upload.pdf"
    with _write_lock:
        track = _lookup(store.get_track, track_id)
        prefix = f"m{len(track.materials)}"
        store.save_material_text(track_id, prefix, {"track_id": track_id, "material": prefix, "filename": name,
                                                    "pages": pages})
        track.materials.append(Material(kind="pdf", ref=name, dataset_title=name))
        track.knowledge_points += _prefix(pdf.heading_kps(pages, "_"), prefix)
        store.save_track(track)
    done = threading.Event()
    with _pending_lock:
        _pending_kps.setdefault(track_id, []).append(done)
    background.add_task(_refine_kps, store, track_id, prefix, pages, name, llm, done)
    queue_deck(store, track_id, background, llm)  # the slides build themselves (after the KPs) from the new material
    return track


@tutor_router.get("/tracks/{track_id}/deck")
def get_deck(track_id: str, store: Store = Depends(get_store)):
    _lookup(store.get_track, track_id)
    doc = store.get_deck(track_id)
    if doc and doc.get("status") == "generating" and track_id not in _deck_running:
        # nothing is building it any more (the server restarted mid-run): say so, so the lobby offers a retry
        doc = {**doc, "status": "failed", "error": "slide generation stopped before it finished"}
    return decks.deck_view(track_id, doc)


# Slide generation: one worker per track. A request while it runs (new material) makes it run once more after.
_deck_wanted: dict[str, int] = {}
_deck_running: set[str] = set()
_deck_lock = threading.Lock()


def _deck_worker(store: Store, track_id: str, llm) -> None:
    first = True
    while True:
        with _deck_lock:
            serial = _deck_wanted.get(track_id, 0)
        if not first:  # a newer request came in while the last run finished: show it as generating again
            store.save_deck(track_id, {**(store.get_deck(track_id) or {}), "status": "generating", "updated_at": decks.now()})
        first = False
        try:
            wait_for_kps(track_id)  # slides are built from the KPs: never from an upload's placeholder headings
            decks.run_generation(store, track_id, llm, again=lambda: _deck_wanted.get(track_id, 0) != serial)
        finally:
            with _deck_lock:
                if _deck_wanted.get(track_id, 0) == serial:
                    _deck_running.discard(track_id)
                    return


def queue_deck(store: Store, track_id: str, background: BackgroundTasks, llm) -> dict:
    """Marks the track's deck generating and makes sure a worker builds it (once more, if one is already running)."""
    with _deck_lock:
        _deck_wanted[track_id] = _deck_wanted.get(track_id, 0) + 1
        start = track_id not in _deck_running
        _deck_running.add(track_id)
    doc = {**(store.get_deck(track_id) or {}), "status": "generating", "error": "", "updated_at": decks.now()}
    store.save_deck(track_id, doc)
    if start:
        background.add_task(_deck_worker, store, track_id, llm)
    return doc


@tutor_router.post("/tracks/{track_id}/deck")
@_locked
def generate_deck(track_id: str, background: BackgroundTasks, store: Store = Depends(get_store),
                  llm: decks.LLM = Depends(get_deck_llm)):
    """Starts (re)generating the track's deck in the background. Poll GET for status. Uploads call this by themselves."""
    _lookup(store.get_track, track_id)
    return decks.deck_view(track_id, queue_deck(store, track_id, background, llm))


@tutor_router.get("/context/{lesson_id}")
def get_context(lesson_id: str, store: Store = Depends(get_store)):
    lesson = _lookup(store.get_lesson, lesson_id)
    track = _lookup(store.get_track, lesson.track_id)
    return {
        "tutor": _lookup(store.get_tutor, lesson.tutor_id),
        "profile": _lookup(store.get_profile, track.user_id),
        "track": track,
        "recent_lessons": store.recent_lessons(track.track_id, 3),
        "resume": store.latest_state(track.track_id, lesson_id),  # where the last lesson stopped, or None
    }


@tutor_router.post("/lessons/{lesson_id}/progress")
@_locked
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


@tutor_router.post("/lessons/{lesson_id}/state")
@_locked
def save_state(lesson_id: str, body: LessonCheckpoint, store: Store = Depends(get_store)) -> LessonCheckpoint:
    """The agent's lesson-state checkpoint (every tutor turn / 60 s); only the latest is kept."""
    lesson = _lookup(store.get_lesson, lesson_id)
    lesson.state = body.model_copy(update={"saved_at": datetime.now(timezone.utc).isoformat()})
    store.save_lesson(lesson)
    return lesson.state


@tutor_router.get("/lessons/{lesson_id}/state")
def get_state(lesson_id: str, store: Store = Depends(get_store)) -> Optional[LessonCheckpoint]:
    return _lookup(store.get_lesson, lesson_id).state


@tutor_router.post("/lessons/{lesson_id}/end")
@_locked
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


@tutor_router.post("/session")
def start_session(body: SessionIn, store: Store = Depends(get_store)):
    url = os.environ.get("LIVEKIT_URL")
    if not (url and os.environ.get("LIVEKIT_API_KEY") and os.environ.get("LIVEKIT_API_SECRET")):
        raise HTTPException(503, "LiveKit is not configured")
    _lookup(store.get_track, body.track_id)
    _lookup(store.get_tutor, body.tutor_id)
    lesson = store.create_lesson(body.track_id, body.tutor_id)
    room = f"tutor-{lesson.lesson_id}"
    token = mint_token(
        room=room, identity=f"student-{body.user_id}",
        agent_name=os.environ.get("TUTOR_AGENT_NAME") or "scholartwin-tutor",
        metadata={"track_id": body.track_id, "lesson_id": lesson.lesson_id, "tutor_id": body.tutor_id},
    )
    return {"url": url, "token": token, "room": room, "lesson_id": lesson.lesson_id}
