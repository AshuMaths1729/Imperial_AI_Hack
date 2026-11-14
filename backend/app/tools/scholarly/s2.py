"""Semantic Scholar Graph API: `/paper/search`."""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable

import httpx

from app.core.errors import UpstreamError
from app.tools.scholarly.models import Paper, authors_year, clean_doi

S2_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
S2_FIELDS = "title,abstract,tldr,year,venue,externalIds,authors,citationCount"
TIMEOUT_S = 20.0
RETRY_STATUS = {429, 500, 502, 503, 504}

Sleep = Callable[[float], Awaitable[None]]


def _to_paper(item: dict) -> Paper | None:
    pid, title = item.get("paperId"), (item.get("title") or "").strip()
    if not pid or not title:
        return None
    tldr = item.get("tldr") or {}
    year = item.get("year")
    names = [a.get("name") or "" for a in item.get("authors") or []]
    return Paper(
        id=f"s2_{pid}",
        title=title,
        abstract=(item.get("abstract") or "").strip(),
        tldr=((tldr.get("text") if isinstance(tldr, dict) else "") or "").strip(),
        year=year,
        venue=(item.get("venue") or "").strip(),
        doi=clean_doi((item.get("externalIds") or {}).get("DOI")),
        authors_year=authors_year(names, year),
        source="s2",
        citation_count=item.get("citationCount"),
    )


async def search_s2(
    query: str,
    limit: int,
    *,
    http: httpx.AsyncClient,
    api_key: str | None = None,
    max_retries: int = 3,
    sleep: Sleep = asyncio.sleep,
) -> list[Paper]:
    """One request (plus retries on 429/5xx with exponential backoff + jitter)."""
    headers = {"x-api-key": api_key} if api_key else {}
    params = {"query": query, "limit": min(max(limit, 1), 100), "fields": S2_FIELDS}
    resp: httpx.Response | None = None
    for attempt in range(max_retries + 1):
        try:
            resp = await http.get(S2_SEARCH_URL, params=params, headers=headers, timeout=TIMEOUT_S)
        except httpx.HTTPError as exc:
            raise UpstreamError(f"Semantic Scholar request failed: {exc!r}") from exc
        if resp.status_code in RETRY_STATUS and attempt < max_retries:
            retry_after = resp.headers.get("retry-after", "")
            delay = float(retry_after) if retry_after.isdigit() else 2.0**attempt
            await sleep(min(delay, 15.0) + random.uniform(0, 0.5))
            continue
        break
    assert resp is not None
    if resp.status_code != 200:
        raise UpstreamError(
            f"Semantic Scholar returned HTTP {resp.status_code}",
            details={"status": resp.status_code},
        )
    papers = [_to_paper(i) for i in resp.json().get("data") or []]
    return [p for p in papers if p is not None]
