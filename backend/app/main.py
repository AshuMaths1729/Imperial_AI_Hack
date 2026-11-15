"""Application factory.

`create_app()` builds the FastAPI app, auto-discovers every package under `app.modules`,
mounts each module's `router` under `/api` and calls its optional `register(reg)`.

Module convention (`app/modules/<name>/__init__.py`):
    router = APIRouter(...)            # optional; paths are relative to /api
    def register(reg: Registry): ...   # optional; add tools/policies/extractors/sandbox runners

Modules may import only `app.schemas`, `app.core`, `app.llm`, `app.tools`, `app.deps`
(never each other). Packages whose name starts with `_` are skipped.
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from pydantic.json_schema import models_json_schema

import app.modules as modules_pkg
from app.container import build_container, register_defaults
from app.core.errors import install_error_handlers
from app.schemas import CONTRACT_MODELS
from app.settings import Settings, load_settings
from app.tools.registry import Registry

API_PREFIX = "/api"


def discover_modules() -> list[str]:
    names = [m.name for m in pkgutil.iter_modules(modules_pkg.__path__) if m.ispkg]
    return sorted(n for n in names if not n.startswith("_"))


def _custom_openapi(app: FastAPI) -> dict[str, Any]:
    """OpenAPI with every shared contract model included, even if no route uses it yet, so
    the generated TypeScript types always cover the §3.3 schemas."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title, version=app.version, routes=app.routes, description=app.description
    )
    _, defs = models_json_schema(
        [(model, mode) for model, mode in CONTRACT_MODELS],  # type: ignore[misc]
        ref_template="#/components/schemas/{model}",
    )
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    for name, definition in defs.get("$defs", {}).items():
        components.setdefault(name, definition)
    app.openapi_schema = schema
    return schema


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    app = FastAPI(title="Athena API", version="0.2.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    registry = Registry()
    register_defaults(registry)

    loaded: list[str] = []
    for name in discover_modules():
        mod = importlib.import_module(f"app.modules.{name}")
        router = getattr(mod, "router", None)
        if router is not None:
            app.include_router(router, prefix=API_PREFIX)
        register = getattr(mod, "register", None)
        if callable(register):
            register(registry)
        loaded.append(name)

    app.state.container = build_container(settings, registry)
    app.state.modules = loaded
    app.openapi = lambda: _custom_openapi(app)  # type: ignore[method-assign]
    return app


_app: FastAPI | None = None


def __getattr__(name: str) -> Any:
    """Lazy module attribute so `uvicorn app.main:app` works without building an app (and
    reading `.env`) as an import side effect."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(name)
