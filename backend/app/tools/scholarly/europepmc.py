"""Europe PMC `/search` fallback (covers PubMed + bioRxiv/medRxiv with abstracts, no key)."""

from __future__ import annotations

import httpx

from app.core.errors import UpstreamError
from app.tools.scholarly.models import Paper, authors_year, clean_doi

EPMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
TIMEOUT_S = 20.0


async def search_europepmc(
    query: str, limit: int, *, http: httpx.AsyncClient
) -> list[Paper]:
    params = {
        "query": query,
        "format": "json",
        "resultType": "core",
        "pageSize": str(min(max(limit, 1), 50)),
    }
    try:
        resp = await http.get(EPMC_URL, params=params, timeout=TIMEOUT_S)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Europe PMC request failed: {exc!r}") from exc
    if resp.status_code != 200:
        raise UpstreamError(
            f"Europe PMC returned HTTP {resp.status_code}",
            details={"status": resp.status_code},
        )
    results = (resp.json().get("resultList") or {}).get("result") or []
    papers: list[Paper] = []
    for item in results:
        pid = str(item.get("id") or "").strip()
        title = " ".join(str(item.get("title") or "").split())
        abstract = " ".join(str(item.get("abstractText") or "").split())
        if not pid or not title or not abstract:
            continue
        year_raw = item.get("pubYear")
        year = int(year_raw) if year_raw and str(year_raw).isdigit() else None
        author_str = str(item.get("authorString") or "")
        names = [a.strip() for a in author_str.split(",") if a.strip()]
        papers.append(
            Paper(
                id=f"epmc_{pid}",
                title=title,
                abstract=abstract,
                year=year,
                venue=str(item.get("journalTitle") or item.get("source") or "EuropePMC").strip(),
                doi=clean_doi(item.get("doi")),
                authors_year=authors_year(names, year),
                source="europepmc",
                citation_count=item.get("citedByCount"),
            )
        )
    return papers
