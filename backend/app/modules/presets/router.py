"""/api/presets: list, freeze, load, current, unload."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel

from app.deps import get_settings
from app.modules.presets import service
from app.settings import Settings

router = APIRouter(prefix="/presets", tags=["presets"])


class FreezeRequest(BaseModel):
    # state subdirs to snapshot (e.g. ["graphs", "sims"]); "cache" selects the LLM cache.
    include: list[str] | None = None


@router.get("")
def list_presets(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return {
        "presets": service.list_presets(settings),
        "current": service.current_preset(settings),
    }


@router.get("/current")
def current(settings: Settings = Depends(get_settings)) -> dict[str, str | None]:
    return {"name": service.current_preset(settings)}


@router.post("/unload")
def unload(settings: Settings = Depends(get_settings)) -> dict[str, str | None]:
    service.unload_preset(settings)
    return {"name": None}


@router.post("/{name}/freeze")
def freeze(
    name: str,
    body: FreezeRequest | None = Body(default=None),
    overwrite: bool = Query(default=False),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    return service.freeze_preset(
        settings, name, include=body.include if body else None, overwrite=overwrite
    )


@router.post("/{name}/load")
def load(name: str, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return service.load_preset(settings, name)
