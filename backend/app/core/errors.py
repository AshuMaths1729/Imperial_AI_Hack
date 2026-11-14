"""One error family and one JSON error envelope for the whole API.

Every error response looks like `{"error": {"code": "...", "message": "...", "details": {...}}}`
(`app.schemas.health.ErrorEnvelope`). Raise an `AppError` subclass anywhere (services, broker,
LLM layer); `install_error_handlers(app)` turns it into that envelope. C1 adds logging /
request ids on top.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.health import ErrorBody, ErrorEnvelope

log = logging.getLogger(__name__)


class AppError(Exception):
    """Base class. Subclasses set a stable `code` and the HTTP `status_code`."""

    code: str = "app_error"
    status_code: int = 500

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
    ) -> None:
        self.message = message or self.__class__.__name__
        self.details = details
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.message)

    def to_envelope(self) -> ErrorEnvelope:
        return ErrorEnvelope(
            error=ErrorBody(code=self.code, message=self.message, details=self.details)
        )


class NotFound(AppError):
    code = "not_found"
    status_code = 404


class JobNotFound(NotFound):
    code = "job_not_found"


class OfflineCacheMiss(AppError):
    """CACHE_MODE=offline and the result is not in the cache (fail loudly, never go live)."""

    code = "offline_cache_miss"
    status_code = 503


class ToolNotAllowed(AppError):
    """The route's policy does not list this tool."""

    code = "tool_not_allowed"
    status_code = 403


class BudgetExceeded(AppError):
    """A per-route cap (calls, cost, iterations) was hit."""

    code = "budget_exceeded"
    status_code = 429


class ToolTimeout(AppError):
    code = "tool_timeout"
    status_code = 504


class UpstreamError(AppError):
    """An external service (LLM, scholarly API, MCP server, ...) failed."""

    code = "upstream_error"
    status_code = 502


class LLMRefusal(AppError):
    """The model refused (`stop_reason == "refusal"`)."""

    code = "llm_refusal"
    status_code = 422


class LLMTruncated(AppError):
    """`stop_reason == "max_tokens"` and the retry did not help."""

    code = "llm_truncated"
    status_code = 502


class SchemaValidationError(AppError):
    """Model output failed validation against the shared schema, even after the retry."""

    code = "schema_validation_error"
    status_code = 502


class ExtractorUnavailable(AppError):
    """The requested extractor backend is not registered or cannot be reached."""

    code = "extractor_unavailable"
    status_code = 503


def _response(status: int, code: str, message: str, details: dict[str, Any] | None) -> JSONResponse:
    envelope = ErrorEnvelope(error=ErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=status, content=envelope.model_dump(mode="json"))


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            log.warning("%s: %s", exc.code, exc.message)
        return _response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "HTTP error"
        details = None if isinstance(exc.detail, str) else {"detail": jsonable_encoder(exc.detail)}
        return _response(exc.status_code, f"http_{exc.status_code}", message, details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _response(
            422,
            "validation_error",
            "Request validation failed",
            {"errors": jsonable_encoder(exc.errors())},
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return _response(500, "internal_error", "Internal server error", None)
