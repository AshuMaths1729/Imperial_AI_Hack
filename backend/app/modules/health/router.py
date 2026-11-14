from __future__ import annotations

import json

from fastapi import APIRouter, Depends

from app.deps import get_settings
from app.schemas.health import HealthResponse
from app.settings import Settings

router = APIRouter(tags=["health"])


def _loaded_preset(settings: Settings) -> str | None:
    """Name of the Demo Preset loaded through /api/presets (marker file), else the setting."""
    try:
        marker = json.loads((settings.state_dir / "_preset.json").read_text(encoding="utf-8"))
        name = marker.get("name") if isinstance(marker, dict) else None
        if isinstance(name, str) and name:
            return name
    except (OSError, ValueError):
        pass
    return settings.preset


@router.get("/health", response_model=HealthResponse)
def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        status="ok", cache_mode=settings.cache_mode, preset=_loaded_preset(settings)
    )
