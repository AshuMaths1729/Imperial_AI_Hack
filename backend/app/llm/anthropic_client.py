"""`AnthropicLLM`: the real `LLMClient` (Claude via the official async SDK).

`parse` sends one structured-output request (the Pydantic `output` type becomes
`output_config.format`, the same wire request `messages.parse(output_format=...)` builds; we
call `messages.create` so we can read `stop_reason` before validating: `parse` raises a bare
`ValidationError` on a truncated reply and hides the refusal / truncation distinction).
No forced `tool_choice`, no assistant prefill, no `temperature`, no `thinking` override: the
newest models reject all of them.

Every result is cached under a content-addressed key (see `cache_key`) and honours
`settings.cache_mode`: live (read-through), offline (cache only), refresh (always call).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import anthropic
from pydantic import BaseModel, ValidationError

from app.core.cache import CacheStore
from app.core.errors import (
    LLMRefusal,
    LLMTruncated,
    OfflineCacheMiss,
    SchemaValidationError,
    UpstreamError,
)
from app.llm.client import Content, LLMResult, M, ParseRequest, Usage
from app.settings import Settings

log = logging.getLogger(__name__)

CACHE_NS = "llm"
DEFAULT_MAX_TOKENS = 16000
MAX_TOKENS_CEILING = 64000
BATCH_CONCURRENCY = 6
_LONG_STRING = 1024  # strings longer than this are hashed in the cache key (base64 payloads)


# ------------------------------------------------------------------------------ cache key
def _canonical(value: Any) -> Any:
    """JSON-able, order-independent form of `content`, with long strings replaced by a digest."""
    if isinstance(value, str):
        if len(value) > _LONG_STRING:
            digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
            return f"sha256:{digest}:{len(value)}"
        return value
    if isinstance(value, Mapping):
        return {str(k): _canonical(v) for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, Sequence | set | frozenset) and not isinstance(value, bytes | bytearray):
        return [_canonical(v) for v in value]
    if isinstance(value, bytes | bytearray):
        return f"sha256:{hashlib.sha256(bytes(value)).hexdigest()}:{len(value)}"
    return value


def schema_fingerprint(output: type[BaseModel]) -> str:
    schema = json.dumps(output.model_json_schema(), sort_keys=True)
    return hashlib.sha256(schema.encode("utf-8")).hexdigest()[:16]


def cache_key(
    *,
    route: str,
    model: str,
    prompt_version: str,
    prompt: str,
    content: Content,
    output: type[BaseModel],
) -> str:
    payload = {
        "route": route,
        "model": model,
        "prompt_version": prompt_version,
        "prompt": _canonical(prompt),
        "content": _canonical(content),
        "output": output.__name__,
        "schema": schema_fingerprint(output),
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------------- client
ClientFactory = Callable[[], Any]


class AnthropicLLM:
    """Implements `app.llm.client.LLMClient`. `client_factory` is for tests (a fake SDK)."""

    def __init__(
        self,
        settings: Settings,
        cache: CacheStore,
        client_factory: ClientFactory | None = None,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self._client_factory = client_factory
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            if self._client_factory is not None:
                self._client = self._client_factory()
            else:
                key = self.settings.anthropic_api_key
                if key is None:
                    raise UpstreamError("ANTHROPIC_API_KEY is not set")
                # an explicit timeout also disables the SDK's "use streaming for big
                # max_tokens" guard, which would reject the larger retry limit
                self._client = anthropic.AsyncAnthropic(
                    api_key=key.get_secret_value(), timeout=600.0, max_retries=2
                )
        return self._client

    # ------------------------------------------------------------------------- parse
    async def parse(
        self,
        route: str,
        prompt: str,
        content: Content,
        output: type[M],
        *,
        prompt_version: str = "",
        max_tokens: int | None = None,
    ) -> LLMResult[M]:
        model = self.settings.model_for(route)
        key = cache_key(
            route=route,
            model=model,
            prompt_version=prompt_version,
            prompt=prompt,
            content=content,
            output=output,
        )
        mode = self.settings.cache_mode
        if mode != "refresh":
            hit = await self._cache_read(key, output)
            if hit is not None:
                return hit
            if mode == "offline":
                raise OfflineCacheMiss(
                    f"No cached LLM result for route {route!r} (CACHE_MODE=offline)",
                    details={"route": route, "key": key},
                )
        result = await self._call(route, model, prompt, content, output, max_tokens)
        await self._cache_write(key, result)
        return result

    async def _cache_read(self, key: str, output: type[M]) -> LLMResult[M] | None:
        raw = await self.cache.get(CACHE_NS, key)
        if raw is None:
            return None
        try:
            parsed = output.model_validate(raw["output"])
        except (KeyError, ValidationError, TypeError):
            log.warning("ignoring unreadable LLM cache entry %s", key)
            return None
        return LLMResult(
            output=parsed,
            model=str(raw.get("model", "")),
            stop_reason=raw.get("stop_reason"),
            usage=Usage(**{k: int(v) for k, v in (raw.get("usage") or {}).items() if k in _USAGE}),
            cost_usd=raw.get("cost_usd"),
            cached=True,
        )

    async def _cache_write(self, key: str, result: LLMResult[Any]) -> None:
        await self.cache.put(
            CACHE_NS,
            key,
            {
                "output": result.output.model_dump(mode="json"),
                "model": result.model,
                "stop_reason": result.stop_reason,
                "usage": {k: getattr(result.usage, k) for k in _USAGE},
                "cost_usd": result.cost_usd,
            },
        )

    # ---------------------------------------------------------------------- live call
    async def _call(
        self,
        route: str,
        model: str,
        prompt: str,
        content: Content,
        output: type[M],
        max_tokens: int | None,
    ) -> LLMResult[M]:
        client = self._get_client()
        output_config = {
            "effort": self.settings.effort_for(route),
            "format": {
                "type": "json_schema",
                "schema": anthropic.transform_schema(output),
            },
        }
        user_blocks = _as_blocks(content)
        limit = max_tokens or DEFAULT_MAX_TOKENS
        truncation_retried = False
        validation_retried = False
        retry_note: str | None = None
        usage = Usage()

        while True:
            blocks = list(user_blocks)
            if retry_note:
                blocks.append({"type": "text", "text": retry_note})
            try:
                resp = await client.messages.create(
                    model=model,
                    max_tokens=limit,
                    system=prompt,
                    output_config=output_config,
                    messages=[{"role": "user", "content": blocks}],
                )
            except anthropic.APIError as exc:
                raise UpstreamError(
                    f"Anthropic API error on route {route!r}: {type(exc).__name__}",
                    details={"route": route, "status": getattr(exc, "status_code", None)},
                ) from exc
            _add_usage(usage, getattr(resp, "usage", None))
            stop = getattr(resp, "stop_reason", None)

            if stop == "refusal":
                raise LLMRefusal(
                    f"The model refused the {route!r} request", details={"route": route}
                )
            if stop == "max_tokens":
                if truncation_retried:
                    raise LLMTruncated(
                        f"Reply for route {route!r} was cut off at {limit} tokens",
                        details={"route": route, "max_tokens": limit},
                    )
                truncation_retried = True
                limit = min(limit * 2, MAX_TOKENS_CEILING)
                continue

            text = "".join(
                getattr(b, "text", "") for b in resp.content if getattr(b, "type", None) == "text"
            )
            try:
                parsed = output.model_validate_json(text)
            except ValidationError as exc:
                if validation_retried:
                    raise SchemaValidationError(
                        f"Reply for route {route!r} does not match {output.__name__}",
                        details={"route": route, "errors": _short_errors(exc)},
                    ) from exc
                validation_retried = True
                retry_note = (
                    "Your previous reply did not match the required JSON schema "
                    f"({_short_errors(exc)}). Reply again with JSON that matches it exactly."
                )
                continue

            return LLMResult(
                output=parsed,
                model=str(getattr(resp, "model", model) or model),
                stop_reason=stop,
                usage=usage,
                cached=False,
            )

    # -------------------------------------------------------------------- batch / agent
    async def batch_parse(
        self,
        route: str,
        requests: Sequence[ParseRequest],
        output: type[M],
    ) -> list[LLMResult[M]]:
        sem = asyncio.Semaphore(BATCH_CONCURRENCY)

        async def one(req: ParseRequest) -> LLMResult[M]:
            async with sem:
                return await self.parse(
                    route, req.prompt, req.content, output, prompt_version=req.prompt_version
                )

        return list(await asyncio.gather(*(one(r) for r in requests)))

    async def agent(
        self,
        route: str,
        prompt: str,
        *,
        content: Content = "",
        tools: Sequence[str] = (),
        mcp: Sequence[str] = (),
        output: type[M] | None = None,
        prompt_version: str = "",
    ) -> LLMResult[Any]:
        raise NotImplementedError("agent loop is a later iteration")


# --------------------------------------------------------------------------------- helpers
_USAGE = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens")


def _as_blocks(content: Content) -> list[Mapping[str, Any]]:
    blocks: list[Mapping[str, Any]] = (
        [{"type": "text", "text": content}] if isinstance(content, str) else list(content)
    )
    # the API rejects empty text blocks
    blocks = [b for b in blocks if not (b.get("type") == "text" and not b.get("text"))]
    return blocks or [{"type": "text", "text": "Proceed."}]


def _add_usage(total: Usage, u: Any) -> None:
    if u is None:
        return
    total.input_tokens += int(getattr(u, "input_tokens", 0) or 0)
    total.output_tokens += int(getattr(u, "output_tokens", 0) or 0)
    total.cache_read_tokens += int(getattr(u, "cache_read_input_tokens", 0) or 0)
    total.cache_creation_tokens += int(getattr(u, "cache_creation_input_tokens", 0) or 0)


def _short_errors(exc: ValidationError) -> str:
    parts = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:8]]
    return "; ".join(parts)
