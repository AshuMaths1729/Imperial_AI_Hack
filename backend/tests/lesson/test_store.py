import pytest

from app.modules.lesson.store import make_store


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("MONGODB_URI", raising=False)
    return make_store()


def test_seed_on_empty_store(store):
    tutors = store.list_tutors()
    assert len(tutors) == 3
    assert len({t.voice_id for t in tutors}) == 3
    assert [t.track_id for t in store.list_tracks("demo")] == ["differentiation", "gradient-descent"]
    assert store.get_profile("demo").style == "visual"


def test_existing_store_gains_the_new_showcase_track_first_and_keeps_its_data(store, tmp_path, monkeypatch):
    gd = store.get_track("gradient-descent")
    gd.title = "My edited GD"
    store.save_track(gd)
    monkeypatch.setenv("TUTOR_DATA_DIR", str(tmp_path))
    again = make_store()  # restart on the same data
    tracks = again.list_tracks("demo")
    assert tracks[0].track_id == "differentiation" and again.get_track("gradient-descent").title == "My edited GD"


def test_lesson_roundtrip(store):
    track = store.list_tracks("demo")[0]
    lesson = store.create_lesson(track.track_id, "kenji-visual")
    lesson.summary, lesson.ended_at = "x", "2026-01-01T00:00:00+00:00"
    store.save_lesson(lesson)
    assert store.get_lesson(lesson.lesson_id).summary == "x"
    assert store.recent_lessons(track.track_id)[0].summary == "x"


def test_recent_lessons_order_and_limit(store):
    tid = store.list_tracks("demo")[0].track_id
    for i in range(5):
        l = store.create_lesson(tid, "kenji-visual")
        l.summary, l.ended_at = str(i), f"2026-01-0{i + 1}T00:00:00+00:00"
        store.save_lesson(l)
    store.create_lesson(tid, "kenji-visual")  # unended: excluded
    assert [l.summary for l in store.recent_lessons(tid)] == ["4", "3", "2"]


def test_store_persists_across_instances(store, tmp_path):
    t = store.list_tracks("demo")[0]
    t.title = "Renamed"
    store.save_track(t)
    assert make_store().get_track(t.track_id).title == "Renamed"
