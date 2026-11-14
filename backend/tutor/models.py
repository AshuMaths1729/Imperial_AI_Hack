from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class LearnerProfile(BaseModel):
    user_id: str
    name: str
    style: Literal["visual", "verbal", "examples"] = "visual"
    level: str = "undergrad"
    pace: str = "normal"
    notes: List[str] = []


class Tutor(BaseModel):
    tutor_id: str
    name: str
    avatar_id: str
    voice_id: str
    style_prompt: str


class KP(BaseModel):
    kp_id: str
    title: str
    summary: str = ""
    prereq_ids: List[str] = []
    status: Literal["not_started", "introduced", "understood"] = "not_started"
    evidence: str = ""


class Material(BaseModel):
    kind: Literal["pdf", "url", "demo"]
    ref: str
    dataset_title: str


class Track(BaseModel):
    track_id: str
    user_id: str
    title: str
    materials: List[Material] = []
    knowledge_points: List[KP] = []
    created_at: str


class Struggle(BaseModel):
    kp_id: str
    what: str
    tried_explanations: List[str] = []


class Worked(BaseModel):
    kp_id: str
    explanation_style: str


class Lesson(BaseModel):
    lesson_id: str
    track_id: str
    tutor_id: str
    started_at: str
    ended_at: Optional[str] = None
    summary: str = ""
    covered_kp_ids: List[str] = Field(default_factory=list)
    struggles: List[Struggle] = []
    worked: List[Worked] = []
    board_snapshot_ref: Optional[str] = None
