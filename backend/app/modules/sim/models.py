"""Request / response shapes of the sim module."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.base import FiniteFloat, StrictModel
from app.schemas.sim import SimOutput, SimPayload
from app.tools.sandbox import ValidationReport


class SourceLoc(StrictModel):
    """Where in the paper something comes from."""

    section: str = Field(default="", description='Section name/number, e.g. "3.2 Forgetting"')
    page: int | None = Field(default=None, description="1-based PDF page, when known")
    quote: str = Field(default="", max_length=400, description="Short verbatim snippet")


class ParamDoc(StrictModel):
    """Plain-language explanation of one PARAMS slider."""

    key: str = Field(description="The PARAMS key this documents")
    symbol_latex: str = Field(default="", description="LaTeX symbol, e.g. \\Delta S")
    meaning: str = Field(description="What the parameter is, in one plain sentence")
    effect: str = Field(description="What increasing it does to the plot")
    typical: str = Field(default="", description="Typical / paper-reported value, if any")
    source: SourceLoc | None = None


class ConceptDoc(StrictModel):
    """A node of the paper's concept & parameter graph."""

    id: str
    label: str
    kind: Literal[
        "paper", "model", "concept", "variable", "parameter", "assumption", "result", "cited_work"
    ]
    summary: str = Field(description="One-sentence, beginner-friendly explanation")
    detail: str = Field(default="", description="2-4 sentences: why it matters / how it works")
    latex: str = Field(default="", description="Defining formula, if any (no $ delimiters)")
    param_key: str | None = Field(default=None, description="PARAMS key if this is a slider")
    source: SourceLoc | None = None


class ConceptLink(StrictModel):
    """A directed, labelled relation between two concepts."""

    source: str
    target: str
    relation: str = Field(description='Short verb phrase, e.g. "slows the decay of"')
    explanation: str = Field(default="", description="One sentence on why the link holds")
    kind: Literal["prerequisite", "supports", "contradicts", "gap"] = "prerequisite"


class EquationVar(StrictModel):
    symbol_latex: str
    meaning: str


class EquationDoc(StrictModel):
    id: str
    title: str
    latex: str
    explanation: str
    variables: list[EquationVar] = Field(default_factory=list)
    source: SourceLoc | None = None


class DerivationStep(StrictModel):
    title: str
    latex: str = ""
    explanation: str


class SimPreset(StrictModel):
    """A named scenario: slider values that reproduce something from the paper.

    After sanitising, `params` holds a value for EVERY PARAMS key, each within its range.
    """

    name: str
    description: str
    params: dict[str, float]
    expected: str = Field(default="", description="What the learner should see in the plot")
    source: SourceLoc | None = None


class SeriesDoc(StrictModel):
    name: str = Field(description="Must equal a series name returned by simulate()")
    meaning: str
    how_to_read: str = ""


class SimDocs(StrictModel):
    """Explanatory material generated alongside the code (all PaperSim tabs read this)."""

    overview: str = Field(description="3-5 sentence plain-language summary of the paper's idea")
    key_findings: list[str] = Field(default_factory=list)
    params: list[ParamDoc] = Field(default_factory=list)
    concepts: list[ConceptDoc] = Field(default_factory=list)
    links: list[ConceptLink] = Field(default_factory=list)
    equations: list[EquationDoc] = Field(default_factory=list)
    derivation: list[DerivationStep] = Field(default_factory=list)
    presets: list[SimPreset] = Field(default_factory=list)
    series: list[SeriesDoc] = Field(default_factory=list)
    x_meaning: str = ""
    y_meaning: str = ""
    limitations: list[str] = Field(default_factory=list)
    glossary: list[EquationVar] = Field(default_factory=list)


# ------------------------------------------------------------------ LLM-facing draft shapes
# Structured outputs compile the JSON schema into a grammar, and every optional / nullable
# field multiplies its size: `SimDocs` as-is is rejected ("compiled grammar is too large").
# So the model fills these flat, all-required mirrors ("" / 0 mean "none"), and
# `app.modules.sim.docs.sanitize_docs` turns them into `SimDocs`. They also avoid
# `dict[str, float]`, which structured outputs can only express as an always-empty `{}`.


class DraftSource(StrictModel):
    section: str = Field(description='Section as printed, e.g. "3.2 Forgetting"; "" if none')
    page: int = Field(description="1-based page of the PDF file; 0 when unsure")
    quote: str = Field(description='Verbatim snippet of at most ~25 words; "" if none')


class DraftParamDoc(StrictModel):
    key: str
    symbol_latex: str
    meaning: str
    effect: str
    typical: str
    source: DraftSource


class DraftParent(StrictModel):
    """An incoming link of a concept: `<source> <relation> <this concept>`."""

    source: str = Field(description="id of a concept listed EARLIER")
    relation: str
    explanation: str
    kind: Literal["prerequisite", "supports", "contradicts", "gap"]


class DraftConcept(StrictModel):
    """Concepts carry their own incoming links (`parents`): writing each link next to its
    target keeps the model from dropping the link list, and listing parents first makes
    the graph a top-down DAG by construction."""

    id: str
    label: str
    kind: Literal[
        "paper", "model", "concept", "variable", "parameter", "assumption", "result", "cited_work"
    ]
    summary: str
    detail: str
    latex: str
    param_key: str = Field(description='PARAMS key for kind "parameter", else ""')
    source: DraftSource
    parents: list[DraftParent]


class DraftEquation(StrictModel):
    id: str
    title: str
    latex: str
    explanation: str
    variables: list[EquationVar]
    source: DraftSource


class DraftDerivationStep(StrictModel):
    title: str
    latex: str
    explanation: str


class PresetValue(StrictModel):
    key: str
    value: FiniteFloat


class DraftPreset(StrictModel):
    name: str
    description: str
    values: list[PresetValue]
    expected: str
    source: DraftSource


class DraftSeriesDoc(StrictModel):
    name: str
    meaning: str
    how_to_read: str


class CoreDocsDraft(StrictModel):
    """The part of `SimDocs` written together with the code (`sim.codegen`): it describes the
    sliders, scenarios and curves of the module the model is writing."""

    overview: str
    key_findings: list[str]
    params: list[DraftParamDoc]
    presets: list[DraftPreset]
    series: list[DraftSeriesDoc]
    x_meaning: str
    y_meaning: str
    limitations: list[str]


class GraphDocsDraft(StrictModel):
    """The rest of `SimDocs` (`sim.docs`, a second call that sees the paper AND the validated
    code): equations, derivation, glossary, concept & parameter graph. Even all-required,
    `SimDocs` in one schema next to the code exceeds the grammar limit, hence two calls.
    The math comes first: a long concept list written first used to crowd it out."""

    equations: list[DraftEquation]
    derivation: list[DraftDerivationStep]
    glossary: list[EquationVar]
    concepts: list[DraftConcept]


class SimDraft(StrictModel):
    """What the model returns for `sim.codegen`."""

    title: str
    code: str
    explanation: str
    assumptions: list[str]
    equation_latex: str
    # The source paper's own title (not the simulation's).
    paper_title: str
    docs: CoreDocsDraft


class RepairDraft(StrictModel):
    """What the model returns for `sim.repair` (it never sees the paper, so no title / docs:
    the router keeps the codegen ones)."""

    title: str
    code: str
    explanation: str
    assumptions: list[str]
    equation_latex: str


class GenerateRequest(StrictModel):
    paper_text: str | None = Field(default=None, max_length=200_000)
    arxiv_id: str | None = None
    hint: str | None = Field(default=None, max_length=2_000)


class SimSpec(SimPayload):
    """A stored simulation: the `SimPayload` plus provenance and validation."""

    sim_id: str
    title: str
    explanation: str = ""
    assumptions: list[str] = Field(default_factory=list)
    docs: SimDocs | None = None
    validation: ValidationReport


class RunRequest(StrictModel):
    sim_id: str
    params: dict[str, FiniteFloat] = Field(default_factory=dict)


class RunResponse(StrictModel):
    output: SimOutput
    runner: str
    ms: float
    cached: bool
    params: dict[str, float]
