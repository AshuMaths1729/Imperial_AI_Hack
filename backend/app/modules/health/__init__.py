"""GET /api/health: status, cache mode and the loaded Demo Preset (drives the offline badge)."""

from app.modules.health.router import router

__all__ = ["router"]
