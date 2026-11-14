"""Normalised paper record shared by the S2 and OpenAlex clients."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel


class Paper(BaseModel):
    id: str  # "s2_<paperId>" | "oa_<W...>": filesystem- and URL-safe
    title: str
    abstract: str = ""
    tldr: str = ""
    year: int | None = None
    venue: str = ""
    doi: str | None = None
    authors_year: str = ""
    source: Literal["s2", "openalex"] = "s2"
    citation_count: int | None = None

    @property
    def usable(self) -> bool:
        return bool(self.abstract.strip() or self.tldr.strip())

    def texts(self) -> list[str]:
        """The texts a verbatim quote may come from."""
        return [t for t in (self.abstract, self.tldr) if t.strip()]


def authors_year(names: list[str], year: int | None) -> str:
    """'Smith et al., 2021' / 'Smith & Jones, 2021' / 'Smith, 2021'."""
    last = [n.split()[-1] for n in names if n and n.strip()]
    if not last:
        who = ""
    elif len(last) == 1:
        who = last[0]
    elif len(last) == 2:
        who = f"{last[0]} & {last[1]}"
    else:
        who = f"{last[0]} et al."
    return ", ".join(p for p in (who, str(year) if year else "") if p)


def clean_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    doi = doi.strip().lower()
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
    return doi or None


def title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def dedupe_papers(papers: list[Paper]) -> list[Paper]:
    """Order-preserving dedupe by DOI and by normalised title."""
    seen_doi: set[str] = set()
    seen_title: set[str] = set()
    out: list[Paper] = []
    for p in papers:
        doi = clean_doi(p.doi)
        tkey = title_key(p.title)
        if (doi and doi in seen_doi) or (tkey and tkey in seen_title):
            continue
        if doi:
            seen_doi.add(doi)
        if tkey:
            seen_title.add(tkey)
        out.append(p)
    return out
