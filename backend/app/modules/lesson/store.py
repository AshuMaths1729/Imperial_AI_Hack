"""Persistence behind one interface: JSON files (default) or MongoDB (when MONGODB_URI is set)."""
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Type, TypeVar

from pydantic import BaseModel

from .models import Lesson, LearnerProfile, Track, Tutor
from . import seed

M = TypeVar("M", bound=BaseModel)


class JsonBackend:
    """One JSON file per collection: {key: doc}. Written via temp file + os.replace."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def _read(self, coll: str) -> dict:
        p = self.root / f"{coll}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def all(self, coll: str) -> List[dict]:
        with self.lock:
            return list(self._read(coll).values())

    def get(self, coll: str, key: str):
        with self.lock:
            return self._read(coll).get(key)

    def put(self, coll: str, key: str, doc: dict) -> None:
        with self.lock:
            data = self._read(coll)
            data[key] = doc
            tmp = self.root / f"{coll}.json.tmp"
            tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            os.replace(tmp, self.root / f"{coll}.json")


class MongoBackend:
    def __init__(self, uri: str):
        from pymongo import MongoClient  # imported lazily: only needed when MONGODB_URI is set

        self.db = MongoClient(uri).get_default_database(default="scholartwin_tutor")

    def all(self, coll: str) -> List[dict]:
        return [{k: v for k, v in d.items() if k != "_id"} for d in self.db[coll].find()]

    def get(self, coll: str, key: str):
        d = self.db[coll].find_one({"_id": key})
        return {k: v for k, v in d.items() if k != "_id"} if d else None

    def put(self, coll: str, key: str, doc: dict) -> None:
        self.db[coll].replace_one({"_id": key}, doc, upsert=True)


class Store:
    def __init__(self, backend):
        self.b = backend
        seed.apply(self.b)  # adds missing seed docs only (new showcase tracks reach existing stores), never overwrites

    def _get(self, coll: str, key: str, model: Type[M]) -> M:
        doc = self.b.get(coll, key)
        if doc is None:
            raise KeyError(f"{coll[:-1]} not found: {key}")
        return model.model_validate(doc)

    def get_profile(self, user_id: str) -> LearnerProfile:
        return self._get("profiles", user_id, LearnerProfile)

    def list_tutors(self) -> List[Tutor]:
        # Only the current line-up, in seed order. Retired tutors stay stored so older lessons still resolve.
        docs = {d["tutor_id"]: d for d in self.b.all("tutors")}
        return [Tutor.model_validate(docs[i]) for i in seed.TUTOR_IDS if i in docs]

    def get_tutor(self, tutor_id: str) -> Tutor:
        return self._get("tutors", tutor_id, Tutor)

    def list_tracks(self, user_id: str) -> List[Track]:
        tracks = [t for t in (Track.model_validate(d) for d in self.b.all("tracks")) if t.user_id == user_id]
        order = [t.track_id for t in seed.demo_tracks()]  # showcase tracks first, in seed order; the rest after
        return sorted(tracks, key=lambda t: order.index(t.track_id) if t.track_id in order else len(order))

    def get_track(self, track_id: str) -> Track:
        return self._get("tracks", track_id, Track)

    def save_track(self, track: Track) -> None:
        self.b.put("tracks", track.track_id, track.model_dump())

    def create_lesson(self, track_id: str, tutor_id: str) -> Lesson:
        lesson = Lesson(lesson_id=uuid.uuid4().hex[:12], track_id=track_id, tutor_id=tutor_id,
                        started_at=datetime.now(timezone.utc).isoformat())
        self.save_lesson(lesson)
        return lesson

    def get_lesson(self, lesson_id: str) -> Lesson:
        return self._get("lessons", lesson_id, Lesson)

    def save_lesson(self, lesson: Lesson) -> None:
        self.b.put("lessons", lesson.lesson_id, lesson.model_dump())

    def get_deck(self, track_id: str) -> Optional[dict]:
        """Deck generation doc for a track (tutor/deck.py): {status, deck, error, warnings, updated_at}."""
        return self.b.get("decks", track_id)

    def save_deck(self, track_id: str, doc: dict) -> None:
        self.b.put("decks", track_id, doc)

    def get_material_text(self, track_id: str, material: str) -> Optional[dict]:
        """Full text of an uploaded material (tutor/pdf.py): {track_id, material, filename, pages: [str]}."""
        return self.b.get("material_texts", f"{track_id}:{material}")

    def save_material_text(self, track_id: str, material: str, doc: dict) -> None:
        self.b.put("material_texts", f"{track_id}:{material}", doc)

    def recent_lessons(self, track_id: str, n: int = 3) -> List[Lesson]:
        done = [l for l in (Lesson.model_validate(d) for d in self.b.all("lessons"))
                if l.track_id == track_id and l.ended_at]
        return sorted(done, key=lambda l: l.ended_at, reverse=True)[:n]


    def latest_state(self, track_id: str, exclude_lesson_id: str) -> Optional[dict]:
        """The newest checkpoint of any other lesson on the track (ended or not), with its lesson_id."""
        saved = [l for l in (Lesson.model_validate(d) for d in self.b.all("lessons"))
                 if l.track_id == track_id and l.lesson_id != exclude_lesson_id and l.state]
        if not saved:
            return None
        last = max(saved, key=lambda l: l.state.saved_at)
        return {**last.state.model_dump(), "lesson_id": last.lesson_id}


def make_store() -> Store:
    uri = os.environ.get("MONGODB_URI")
    if uri:
        return Store(MongoBackend(uri))
    default = Path(__file__).parent / "data"
    return Store(JsonBackend(Path(os.environ.get("TUTOR_DATA_DIR", default))))
