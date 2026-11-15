"""Spec storage and run cache."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections import OrderedDict
from pathlib import Path

from app.core.errors import AppError, NotFound
from app.modules.sim.models import SimSpec
from app.schemas.sim import SimOutput
from app.settings import Settings

_ID_RE = re.compile(r"^[A-Za-z0-9_]{1,64}$")


class BadRequest(AppError):
    code = "bad_request"
    status_code = 422


class SimValidationFailed(AppError):
    """Generated code failed validation even after the repair attempt."""

    code = "sim_validation_failed"
    status_code = 422


class SimRunFailed(AppError):
    code = "sim_run_failed"
    status_code = 422


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def make_sim_id(code: str) -> str:
    return "sim_" + code_hash(code)[:10]


def sims_dir(settings: Settings) -> Path:
    return settings.state_dir / "sims"


def save_spec(settings: Settings, spec: SimSpec) -> None:
    d = sims_dir(settings)
    d.mkdir(parents=True, exist_ok=True)
    target = d / f"{spec.sim_id}.json"
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(spec.model_dump(mode="json")), encoding="utf-8")
    os.replace(tmp, target)


async def load_spec(settings: Settings, sim_id: str, *, bundled: bool = False) -> SimSpec:
    """A generated simulation by id. `bundled=True` (re-runs only) also serves the frontend's built-in sample
    simulations from the repo fixtures; GET /sim/{id} keeps 404ing for them (the demo routes are retired)."""
    if not _ID_RE.match(sim_id):
        raise NotFound(f"unknown simulation {sim_id!r}")
    path = sims_dir(settings) / f"{sim_id}.json"
    if not path.is_file():
        # Built-in samples (the frontend's "Built-in example" papers) ship as repo fixtures, never generated
        # here; serve them so their sliders, scenarios and sweeps re-run like any other simulation.
        fixture = settings.fixtures_dir / f"{sim_id}.json"
        if bundled and sim_id.startswith("sim_") and fixture.is_file():
            data = json.loads(fixture.read_text(encoding="utf-8"))
            return SimSpec.model_validate({
                "title": data.get("paper_title") or sim_id,
                "validation": {"status": "passed"},  # a curated sample, checked when it was written
                **data,
                "sim_id": sim_id,
            })
        raise NotFound(f"unknown simulation {sim_id!r}")
    return SimSpec.model_validate_json(path.read_text(encoding="utf-8"))


class RunCache:
    """Tiny in-memory LRU keyed by (code hash, params)."""

    def __init__(self, size: int = 512) -> None:
        self.size = size
        self._d: OrderedDict[tuple, tuple[SimOutput, float]] = OrderedDict()

    def get(self, key: tuple) -> tuple[SimOutput, float] | None:
        hit = self._d.get(key)
        if hit is not None:
            self._d.move_to_end(key)
        return hit

    def put(self, key: tuple, value: tuple[SimOutput, float]) -> None:
        self._d[key] = value
        self._d.move_to_end(key)
        while len(self._d) > self.size:
            self._d.popitem(last=False)


run_cache = RunCache()
