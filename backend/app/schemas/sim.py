"""Simulation contract (guide §3.3, Paper2Sim).

The generated code defines `PARAMS = {name: {min, max, default, step, unit, label}}` and
`simulate(**params) -> {title, x_label, y_label, series: [{name, x, y}]}`. These models are
the validated shapes of those two things.

Minimal on purpose: Track B's B1 adds `PaperSource` / `SimSpec` (with validation reports,
code hashes, ...) next to these.
"""

from __future__ import annotations

from pydantic import Field, model_validator

from app.schemas.base import FiniteFloat, StrictModel

MAX_POINTS_PER_SERIES = 5000


class ParamSpec(StrictModel):
    """One entry of `PARAMS` (a slider)."""

    min: FiniteFloat
    max: FiniteFloat
    default: FiniteFloat
    step: FiniteFloat = Field(gt=0)
    unit: str = ""
    label: str

    @model_validator(mode="after")
    def _check_range(self) -> ParamSpec:
        if not self.min < self.max:
            raise ValueError("min must be < max")
        if not self.min <= self.default <= self.max:
            raise ValueError("default must lie within [min, max]")
        return self


class Series(StrictModel):
    name: str
    x: list[FiniteFloat] = Field(max_length=MAX_POINTS_PER_SERIES)
    y: list[FiniteFloat] = Field(max_length=MAX_POINTS_PER_SERIES)
    color: str | None = None  # optional extra, e.g. "#38bdf8"

    @model_validator(mode="after")
    def _same_length(self) -> Series:
        if len(self.x) != len(self.y):
            raise ValueError("x and y must have the same length")
        return self


class SimOutput(StrictModel):
    """Return value of `simulate(**params)`; plain finite numbers, <= 5,000 points/series."""

    title: str
    x_label: str
    y_label: str
    series: list[Series] = Field(min_length=1)


class SimPayload(StrictModel):
    """What the UI needs to show a simulation: sliders, a first plot and paper context.

    `default_output` is `simulate()` at the default params, precomputed so the plot renders
    before any runtime (Pyodide) has loaded.
    """

    params: dict[str, ParamSpec]
    default_output: SimOutput
    # optional extras carried over from the Phase-1 prototype
    equation_latex: str | None = None
    paper_title: str | None = None
    arxiv_id: str | None = None
    python_code: str | None = None
