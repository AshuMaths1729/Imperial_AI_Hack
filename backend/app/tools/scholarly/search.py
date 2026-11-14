"""`search_papers`: Semantic Scholar first, OpenAlex when S2 fails, is throttled or is thin."""

from __future__ import annotations

import asyncio
import logging

import httpx

from app.core.errors import UpstreamError
from app.settings import Settings
from app.tools.scholarly.models import Paper, dedupe_papers
from app.tools.scholarly.openalex import search_openalex
from app.tools.scholarly.s2 import Sleep, search_s2

log = logging.getLogger(__name__)


def _usable(papers: list[Paper]) -> list[Paper]:
    return dedupe_papers([p for p in papers if p.usable])


async def search_papers(
    query: str,
    limit: int,
    *,
    settings: Settings,
    http: httpx.AsyncClient | None = None,
    sleep: Sleep = asyncio.sleep,
) -> list[Paper]:
    """Up to `limit` deduped papers that have an abstract or a TLDR."""
    own = http is None
    client = http or httpx.AsyncClient(timeout=20.0, follow_redirects=True)
    try:
        key = settings.s2_api_key.get_secret_value() if settings.s2_api_key else None
        found: list[Paper] = []
        s2_error: UpstreamError | None = None
        try:
            # over-fetch: papers without an abstract/TLDR are dropped
            found = _usable(
                await search_s2(query, limit * 2, http=client, api_key=key, sleep=sleep)
            )
        except UpstreamError as exc:
            s2_error = exc
            log.warning("Semantic Scholar failed (%s); falling back to OpenAlex", exc.message)

        if len(found) < max(1, limit // 2):
            try:
                oa = await search_openalex(
                    query, limit * 2, http=client, mailto=settings.openalex_mailto
                )
            except UpstreamError as exc:
                if not found:
                    raise (s2_error or exc) from exc
                log.warning("OpenAlex fallback failed too: %s", exc.message)
            else:
                found = _usable(found + oa)
        return found[:limit]
    finally:
        if own:
            await client.aclose()
