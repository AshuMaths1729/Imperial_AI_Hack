"""Request/response models and the flat LLM "draft" models (mapped to `Graph` in code)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import StrictModel
from app.schemas.graph import Graph

# --- API ----------------------------------------------------------------------------------


class TopicRequest(StrictModel):
    query: str = Field(min_length=3, max_length=300)
    max_papers: int = Field(default=12, ge=2, le=30)


class TopicStats(StrictModel):
    papers_found: int
    papers_with_claims: int
    claims: int
    clusters: int
    supports: int
    contradicts: int
    gaps: int


class TopicResult(StrictModel):
    graph_id: str
    graph: Graph
    stats: TopicStats


class PaperOut(StrictModel):
    id: str
    title: str
    abstract: str = ""
    tldr: str = ""
    year: int | None = None
    venue: str = ""
    doi: str | None = None
    authors_year: str = ""


# --- LLM drafts (flat; no constraints beyond what structured outputs support) ----------------


class ClaimDraft(StrictModel):
    entity: str
    property: str
    direction: Literal["positive", "negative", "neutral"]
    value: str
    condition: str  # "" when unconditional
    quote: str  # verbatim substring of the abstract / TLDR


class PaperClaimsDraft(StrictModel):
    claims: list[ClaimDraft]


class NormalizedItem(StrictModel):
    index: int
    entity_key: str
    property_key: str


class NormalizeDraft(StrictModel):
    items: list[NormalizedItem]


class RelationDraft(StrictModel):
    claim_a: int  # index into the numbered claim list
    claim_b: int
    relation: Literal["supports", "contradicts"]
    condition: str  # what reconciles / separates them, e.g. "at T > 60 C"
    quote_a: str
    quote_b: str
    confidence: float


class GapDraft(StrictModel):
    condition: str  # the untested condition combination
    rationale: str
    related_claims: list[int]


class CompareDraft(StrictModel):
    relations: list[RelationDraft]
    gap: GapDraft | None
