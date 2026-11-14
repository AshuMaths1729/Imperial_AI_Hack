"""LEGACY module: the Phase-1 prototype routes, mounted under /api for the existing frontend.

Remove this package once Tracks B/C/D replace its routes (see `router.py`). The old data
shapes live in `legacy_schemas.py`; the old demo JSON in `demo_data/`.
"""

from app.modules.legacy.router import router

__all__ = ["router"]
