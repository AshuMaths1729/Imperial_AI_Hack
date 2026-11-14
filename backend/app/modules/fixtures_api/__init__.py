"""Fixture-backed stand-ins for the real endpoints, so the frontend and other lanes have live
data from day one.

Mounted *before* `legacy` but after every other module (see `LAST_MODULES` in `app/main.py`),
so when a lane adds the real route with the same path, the real one wins. Delete a route
here once its real counterpart has landed; delete the package when all have.
"""

from app.modules.fixtures_api.router import register, router

__all__ = ["register", "router"]
