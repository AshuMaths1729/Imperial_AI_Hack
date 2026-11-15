from datetime import datetime, timezone

from .models import KP, LearnerProfile, Material, Track, Tutor

# Synthesia interactive-avatar ids (only these live avatars join a call; see agent/README.md).
KENJI = "7572faa9-15da-400d-8227-ef1ab8932523"
JENNY = "8788bef1-8020-46e0-a8f4-510ea9989b25"
# Mei's Studio avatar, converted for live use (POST /api/interactive-avatars/avatars reported "completed").
# An empty id would mean voice only.
MEI = "519674df-1ea5-47bc-99d4-8912a6975a66"
TUTOR_AVATARS = {"kenji-visual": KENJI, "jenny-socratic": JENNY, "mei-examples": MEI}

PROFILE = LearnerProfile(user_id="demo", name="Demo Student", style="visual", level="undergrad")

# Three different people who all teach the same way with every tool (agent/prompting.py `persona`);
# style_prompt is personality only, as "<label>: <description>" (the lobby shows both parts).
# Kenji is Brian (premade: deep, resonant and comforting; the most soothing of the voices tried),
# Jenny keeps the voice designed for her face, Mei is Matilda (premade, warm educational alto).
# The lobby's "Hear …" samples (frontend/public/tutors/voices) are recorded in these voices.
TUTORS = [
    Tutor(tutor_id="kenji-visual", name="Kenji", avatar_id=TUTOR_AVATARS["kenji-visual"],
          voice_id="nPczCjzI2devNBz1zQrb",
          style_prompt="Calm and thoughtful: unhurried and warm, with a quiet, dry sense of humour "
                       "and a love of a good analogy."),
    Tutor(tutor_id="jenny-socratic", name="Jenny", avatar_id=TUTOR_AVATARS["jenny-socratic"],
          voice_id="1dJLMOIuKrasdg4BFQb9",
          style_prompt="Bright and encouraging: upbeat and quick to celebrate progress, with a playful "
                       "curiosity about how you are thinking."),
    Tutor(tutor_id="mei-examples", name="Mei", avatar_id=TUTOR_AVATARS["mei-examples"],
          voice_id="XrExE9yKIg1WjnnlVkGX",
          style_prompt="Patient and precise: gentle and reassuring, careful with every detail, and never "
                       "makes you feel rushed."),
]
TUTOR_IDS = [t.tutor_id for t in TUTORS]


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
    """Idempotent seeding: adds seed docs that are missing, never overwrites one (live progress, edited tracks).
    Tutors are configuration, not user data, so they are always rewritten to match TUTORS."""
    for t in TUTORS:
        if backend.get("tutors", t.tutor_id) != t.model_dump():
            backend.put("tutors", t.tutor_id, t.model_dump())
    docs = [("profiles", PROFILE.user_id, PROFILE)] + [("tracks", t.track_id, t) for t in demo_tracks()]
    for coll, key, model in docs:
        if backend.get(coll, key) is None:
            backend.put(coll, key, model.model_dump())
