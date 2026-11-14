"""OpenAlex `/works?search=...` (no key; `mailto` joins the polite pool)."""

from __future__ import annotations

import httpx

from app.core.errors import UpstreamError
from app.tools.scholarly.models import Paper, authors_year, clean_doi

OPENALEX_WORKS_URL = "https://api.openalex.org/works"
OPENALEX_SELECT = (
    "id,doi,title,display_name,publication_year,authorships,abstract_inverted_index,"
    "primary_location,cited_by_count"
)
TIMEOUT_S = 20.0


def rebuild_abstract(inverted: dict[str, list[int]] | None) -> str:
    """OpenAlex ships abstracts as {word: [positions]}; put the words back in order."""
    if not inverted:
        return ""
    by_pos: dict[int, str] = {}
    for word, positions in inverted.items():
        for pos in positions:
            by_pos[pos] = word
    return " ".join(by_pos[i] for i in sorted(by_pos))


def _to_paper(item: dict) -> Paper | None:
    oid = (item.get("id") or "").rsplit("/", 1)[-1]
    title = (item.get("display_name") or item.get("title") or "").strip()
    if not oid or not title:
        return None
    year = item.get("publication_year")
    names = [
        ((a.get("author") or {}).get("display_name") or "") for a in item.get("authorships") or []
    ]
    source = ((item.get("primary_location") or {}).get("source") or {}).get("display_name") or ""
    return Paper(
        id=f"oa_{oid}",
        title=title,
        abstract=rebuild_abstract(item.get("abstract_inverted_index")),
        year=year,
        venue=source.strip(),
        doi=clean_doi(item.get("doi")),
        authors_year=authors_year(names, year),
        source="openalex",
        citation_count=item.get("cited_by_count"),
    )


async def search_openalex(
    query: str, limit: int, *, http: httpx.AsyncClient, mailto: str | None = None
) -> list[Paper]:
    params: dict[str, str | int] = {
        "search": query,
        "per-page": min(max(limit, 1), 100),
        "select": OPENALEX_SELECT,
    }
    if mailto:
        params["mailto"] = mailto
    try:
        resp = await http.get(OPENALEX_WORKS_URL, params=params, timeout=TIMEOUT_S)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"OpenAlex request failed: {exc!r}") from exc
    if resp.status_code != 200:
        raise UpstreamError(
            f"OpenAlex returned HTTP {resp.status_code}", details={"status": resp.status_code}
        )
    papers = [_to_paper(i) for i in resp.json().get("results") or []]
    return [p for p in papers if p is not None]
