"""Flat draft the model fills in; `service.draft_to_graph` turns it into the `Graph` contract.

Kept deliberately flat (labels instead of ids, no nesting) so the model has little to get
wrong: ids, dedupe, edge hygiene and cycle breaking are all done in code.
"""

from __future__ import annotations

from pydantic import Field

from app.schemas.base import StrictModel


class DraftConcept(StrictModel):
    label: str = Field(description="Short concept name, 1-5 words")
    summary: str = Field(description="One or two sentences explaining the concept")
    page: int = Field(description="1-based slide/page number where the concept is introduced")
    aliases: list[str] = Field(
        default_factory=list, description="Other names the lecture uses for the same concept"
    )


class DraftPrerequisite(StrictModel):
    prerequisite: str = Field(description="Label of the concept that must be understood first")
    dependent: str = Field(description="Label of the concept that builds on it")


class LectureDraft(StrictModel):
    concepts: list[DraftConcept]
    prerequisites: list[DraftPrerequisite]
