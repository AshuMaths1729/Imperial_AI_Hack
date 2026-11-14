"""Request / response shapes of the sim module."""

from __future__ import annotations

from pydantic import Field

from app.schemas.base import FiniteFloat, StrictModel
from app.schemas.sim import SimOutput, SimPayload
from app.tools.sandbox import ValidationReport


class SimDraft(StrictModel):
    """What the model returns for `sim.codegen` / `sim.repair`."""

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
