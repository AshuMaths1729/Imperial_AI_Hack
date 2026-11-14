from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import StrictModel

SourceKind = Literal["arxiv_tex", "pdf", "html"]


class Equation(StrictModel):
    label: str | None = None
    latex: str
    context: str = ""


class PaperSource(StrictModel):
    paper_id: str
    source_kind: SourceKind
    title: str
    authors: list[str] = Field(default_factory=list)
    arxiv_id: str | None = None
    abstract: str = ""
    method_text: str
    equations: list[Equation] = Field(default_factory=list)
    macros: list[str] = Field(default_factory=list)
    truncated: bool = False
