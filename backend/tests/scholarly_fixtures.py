"""Canned Semantic Scholar / OpenAlex responses and an httpx MockTransport factory."""

from __future__ import annotations

import httpx

A_ABS = (
    "Li6PS5Cl reaches an ionic conductivity of 5 mS/cm at room temperature. "
    "The material is stable against lithium metal in dry conditions."
)
B_ABS = (
    "We find that Li6PS5Cl shows an ionic conductivity of only 0.5 mS/cm after humid air "
    "exposure. Hydrolysis produces H2S."
)
C_ABS = (
    "LLZO garnet is stable against lithium metal up to 5 V. "
    "Dendrite growth is suppressed at room temperature."
)
D_ABS = (
    "LLZO garnet suffers from lithium dendrites along grain boundaries at high current "
    "density. We report a critical current density of 0.5 mA/cm2."
)


def s2_item(pid, title, abstract, *, year=2021, doi=None, authors=("Alice Smith",), tldr=None):
    return {
        "paperId": pid,
        "title": title,
        "abstract": abstract,
        "tldr": {"text": tldr} if tldr else None,
        "year": year,
        "venue": "J. Power Sources",
        "externalIds": {"DOI": doi} if doi else {},
        "authors": [{"name": n} for n in authors],
        "citationCount": 10,
    }


S2_GOLDEN = {
    "total": 6,
    "data": [
        s2_item(
            "A1",
            "Argyrodite sulfide electrolytes",
            A_ABS,
            doi="10.1/A",
            authors=("Alice Smith", "Bob Jones", "Carl Lee"),
        ),
        s2_item(
            "B2",
            "Moisture sensitivity of argyrodites",
            B_ABS,
            year=2022,
            doi="10.1/B",
            authors=("Dana Wu", "Eve Park"),
        ),
        s2_item("C3", "Garnet LLZO and lithium metal", C_ABS, year=2020, doi="10.1/C"),
        s2_item("D4", "Dendrites in LLZO garnets", D_ABS, year=2023, doi="10.1/D"),
        s2_item("E5", "A paper without abstract", None),  # dropped: no abstract, no TLDR
        s2_item("F6", "Argyrodite Sulfide Electrolytes (preprint)", A_ABS, doi="10.1/A"),  # dup DOI
    ],
}

OA_WORKS = {
    "results": [
        {
            "id": "https://openalex.org/W111",
            "doi": "https://doi.org/10.2/OA1",
            "title": "Solid electrolytes review",
            "display_name": "Solid electrolytes review",
            "publication_year": 2019,
            "authorships": [{"author": {"display_name": "Grace Hopper"}}],
            "abstract_inverted_index": {
                "Solid": [0],
                "electrolytes": [1, 5],
                "enable": [2],
                "safer": [3],
                "batteries.": [4],
                "Sulfide": [6],
                "conduct": [7],
                "well.": [8],
            },
            "primary_location": {"source": {"display_name": "Nature Energy"}},
            "cited_by_count": 7,
        },
        {  # duplicate of the S2 paper by DOI
            "id": "https://openalex.org/W222",
            "doi": "https://doi.org/10.1/A",
            "title": "Argyrodite sulfide electrolytes",
            "display_name": "Argyrodite sulfide electrolytes",
            "publication_year": 2021,
            "authorships": [],
            "abstract_inverted_index": {"Same": [0], "paper.": [1]},
            "primary_location": None,
            "cited_by_count": 1,
        },
        {  # no abstract: dropped
            "id": "https://openalex.org/W333",
            "doi": None,
            "title": "No abstract here",
            "display_name": "No abstract here",
            "publication_year": 2018,
            "authorships": [],
            "abstract_inverted_index": None,
            "primary_location": None,
            "cited_by_count": 0,
        },
    ]
}


class Recorder:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def of(self, host_part: str) -> list[httpx.Request]:
        return [r for r in self.requests if host_part in r.url.host]


def make_http(
    *, s2: tuple[int, dict] = (200, S2_GOLDEN), oa: tuple[int, dict] = (200, {"results": []})
) -> tuple[httpx.AsyncClient, Recorder]:
    rec = Recorder()

    def handler(request: httpx.Request) -> httpx.Response:
        rec.requests.append(request)
        status, body = s2 if "semanticscholar" in request.url.host else oa
        return httpx.Response(status, json=body)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), rec
