"""The tutors a student can pick. Single source of truth: the agent receives this list in its
dispatch metadata."""

from __future__ import annotations

from pydantic import BaseModel

KENJI = "7572faa9-15da-400d-8227-ef1ab8932523"


class Tutor(BaseModel):
    tutor_id: str
    name: str
    tagline: str
    avatar_id: str  # Synthesia interactive-avatar id
    voice_id: str  # ElevenLabs voice id, matched to the avatar's look
    style_prompt: str


JENNY = "8788bef1-8020-46e0-a8f4-510ea9989b25"

TUTORS: list[Tutor] = [
    Tutor(
        tutor_id="kenji-visual",
        name="Kenji",
        tagline="Visual explainer",
        avatar_id=KENJI,
        voice_id="VNFsds98GXgmoyGOuQqo",  # ElevenLabs Voice Design: Japanese professor
        style_prompt=(
            "You are Kenji, a warm visual explainer. Lead with a picture the student can imagine "
            "(an analogy, a shape, a motion), then give the precise idea in plain words."
        ),
    ),
    Tutor(
        tutor_id="jenny-socratic",
        name="Jenny",
        tagline="Socratic coach",
        avatar_id=JENNY,
        voice_id="1dJLMOIuKrasdg4BFQb9",  # ElevenLabs Voice Design: American coach
        style_prompt=(
            "You are Jenny, a patient Socratic coach. Ask one short guiding question "
            "before explaining, build on the student's answer, and only explain directly when "
            "they're stuck."
        ),
    ),
]

BY_ID = {t.tutor_id: t for t in TUTORS}
