"""Demo Preset mode: freeze the live state/cache into `presets/<name>/` and load it back
instantly (no network). Routes under /api/presets. See `service.py` for the file layout."""

from app.modules.presets.router import router

__all__ = ["router"]
