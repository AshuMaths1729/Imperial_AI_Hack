"""Load the shared JSON fixtures from the repo-root `fixtures/` directory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, TypeVar, overload

from pydantic import BaseModel, TypeAdapter

from app.settings import REPO_ROOT

FIXTURES_DIR = REPO_ROOT / "fixtures"

T = TypeVar("T")


def fixture_path(name: str, fixtures_dir: Path | None = None) -> Path:
    if not name.endswith(".json"):
        name += ".json"
    return (fixtures_dir or FIXTURES_DIR) / name


@overload
def load_fixture(name: str, type_: None = None, *, fixtures_dir: Path | None = None) -> Any: ...
@overload
def load_fixture(name: str, type_: type[T], *, fixtures_dir: Path | None = None) -> T: ...
def load_fixture(
    name: str, type_: type[Any] | None = None, *, fixtures_dir: Path | None = None
) -> Any:
    """Read `fixtures/<name>.json`; if `type_` is given, validate and return that type
    (a Pydantic model or anything `TypeAdapter` understands, e.g. `list[JobEvent]`)."""
    raw = json.loads(fixture_path(name, fixtures_dir).read_text(encoding="utf-8"))
    if type_ is None:
        return raw
    if isinstance(type_, type) and issubclass(type_, BaseModel):
        return type_.model_validate(raw)
    return TypeAdapter(type_).validate_python(raw)
