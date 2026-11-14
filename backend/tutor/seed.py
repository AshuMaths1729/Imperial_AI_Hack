from datetime import datetime, timezone

from .models import KP, LearnerProfile, Material, Track, Tutor

KENJI = "7572faa9-15da-400d-8227-ef1ab8932523"
# One line per tutor: swap in Studio av_ ids here once converted.
TUTOR_AVATARS = {"kenji-visual": KENJI, "kenji-socratic": KENJI, "kenji-examples": KENJI}

PROFILE = LearnerProfile(user_id="demo", name="Demo Student", style="visual", level="undergrad")

TUTORS = [
    Tutor(tutor_id="kenji-visual", name="Kenji — visual explainer", avatar_id=TUTOR_AVATARS["kenji-visual"],
          voice_id="JBFqnCBsd6RMkjVDRZzb",
          style_prompt="visual explainer: draws first, then explains"),
    Tutor(tutor_id="kenji-socratic", name="Kenji — Socratic coach", avatar_id=TUTOR_AVATARS["kenji-socratic"],
          voice_id="pNInz6obpgDQGcFmaJgB",
          style_prompt="Socratic coach: asks guiding questions before explaining"),
    Tutor(tutor_id="kenji-examples", name="Kenji — worked examples", avatar_id=TUTOR_AVATARS["kenji-examples"],
          voice_id="nPczCjzI2devNBz1zQrb",
          style_prompt="worked examples: solves a similar problem step by step, then lets you try"),
]


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
