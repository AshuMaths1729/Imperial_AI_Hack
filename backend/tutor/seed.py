from datetime import datetime, timezone

from .models import KP, LearnerProfile, Material, Track, Tutor

KENJI = "7572faa9-15da-400d-8227-ef1ab8932523"
# One line per tutor: swap in Studio av_ ids here once converted.
TUTOR_AVATARS = {"kenji-visual": KENJI, "kenji-socratic": KENJI, "kenji-examples": KENJI}

PROFILE = LearnerProfile(user_id="demo", name="Demo Student", style="visual", level="undergrad")

# Voices: Eric (smooth, trustworthy), Chris (charming, down-to-earth), Bill (wise, mature): calm, friendly tutors.
TUTORS = [
    Tutor(tutor_id="kenji-visual", name="Kenji — visual explainer", avatar_id=TUTOR_AVATARS["kenji-visual"],
          voice_id="cjVigY5qzO86Huf0OWal",
          style_prompt="visual explainer: draws first, then explains"),
    Tutor(tutor_id="kenji-socratic", name="Kenji — Socratic coach", avatar_id=TUTOR_AVATARS["kenji-socratic"],
          voice_id="iP95p4xoKVk53GoZ742B",
          style_prompt="Socratic coach: asks guiding questions before explaining"),
    Tutor(tutor_id="kenji-examples", name="Kenji — worked examples", avatar_id=TUTOR_AVATARS["kenji-examples"],
          voice_id="pqHfZKP75CvOlQylNhV4",
          style_prompt="worked examples: solves a similar problem step by step, then lets you try"),
]


def differentiation_track() -> Track:
    """The A-level showcase. One KP per slide of frontend/src/tutor/slides/decks/differentiation.json."""
    kps = [
        KP(kp_id="d1", title="Speed as a gradient",
           summary="Speed is how steep a distance-time graph is; between two times we can find the average speed."),
        KP(kp_id="d2", title="Gradient of a straight line", summary="Gradient = rise / run, the same anywhere on the line.",
           prereq_ids=["d1"]),
        KP(kp_id="d3", title="Gradient of a chord",
           summary="A chord joins two points on a curve; its gradient is the average gradient between them.",
           prereq_ids=["d2"]),
        KP(kp_id="d4", title="Tangent as the limit of chords",
           summary="As the second point slides onto the first (h -> 0), the chord becomes the tangent.",
           prereq_ids=["d3"]),
        KP(kp_id="d5", title="Differentiation from first principles",
           summary="((x+h)^2 - x^2)/h = 2x + h -> 2x, so the gradient of y = x^2 is dy/dx = 2x.", prereq_ids=["d4"]),
    ]
    return Track(track_id="differentiation", user_id="demo", title="Differentiation — the gradient of a curve",
                 materials=[Material(kind="demo", ref="differentiation_demo",
                                     dataset_title="A-level Maths: Differentiation from first principles")],
                 knowledge_points=kps, created_at=datetime.now(timezone.utc).isoformat())


def demo_track() -> Track:
    kps = [
        KP(kp_id="gd1", title="Loss function", summary="A number that measures how wrong the model is."),
        KP(kp_id="gd2", title="Gradient", summary="The direction of steepest increase of the loss.", prereq_ids=["gd1"]),
        KP(kp_id="gd3", title="Gradient descent step", summary="theta <- theta - eta * grad; move downhill.", prereq_ids=["gd2"]),
        KP(kp_id="gd4", title="Momentum", summary="Add a velocity term so updates smooth out and speed up.", prereq_ids=["gd3"]),
    ]
    return Track(track_id="gradient-descent", user_id="demo", title="Gradient Descent",
                 materials=[Material(kind="demo", ref="lecture_demo", dataset_title="Gradient Descent")],
                 knowledge_points=kps, created_at=datetime.now(timezone.utc).isoformat())


def demo_tracks() -> list:
    return [differentiation_track(), demo_track()]  # lobby order: the first is the showcase


def apply(backend) -> None:
    """Idempotent seeding: adds seed docs that are missing, never overwrites one (live progress, edited tracks)."""
    docs = [("tutors", t.tutor_id, t) for t in TUTORS] + [("profiles", PROFILE.user_id, PROFILE)]
    docs += [("tracks", t.track_id, t) for t in demo_tracks()]
    for coll, key, model in docs:
        if backend.get(coll, key) is None:
            backend.put(coll, key, model.model_dump())
