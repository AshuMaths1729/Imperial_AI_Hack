from __future__ import annotations

import pytest

from app.core.errors import UpstreamError
from app.settings import Settings
from app.tools.scholarly import search_papers
from app.tools.scholarly.openalex import rebuild_abstract
from tests.scholarly_fixtures import OA_WORKS, S2_GOLDEN, make_http


class Sleeps:
    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def test_rebuild_abstract_from_inverted_index():
    inv = {"a": [0, 3], "b": [1], "c": [2]}
    assert rebuild_abstract(inv) == "a b c a"
    assert rebuild_abstract(None) == ""


async def test_s2_search_drops_no_abstract_and_dedupes():
    http, rec = make_http()
    papers = await search_papers("solid-state", 4, settings=Settings(_env_file=None), http=http)
    assert [p.id for p in papers] == ["s2_A1", "s2_B2", "s2_C3", "s2_D4"]
    assert papers[0].authors_year == "Smith et al., 2021"
    assert papers[1].authors_year == "Wu & Park, 2022"
    assert papers[0].doi == "10.1/a"
    assert len(rec.of("semanticscholar")) == 1
    assert rec.of("openalex") == []  # enough results: no fallback
    req = rec.of("semanticscholar")[0]
    assert "x-api-key" not in req.headers
    assert "tldr" in req.url.params["fields"] and "abstract" in req.url.params["fields"]


async def test_s2_api_key_is_sent_only_when_configured():
    http, rec = make_http()
    settings = Settings(_env_file=None, s2_api_key="secret-key")
    await search_papers("solid-state", 4, settings=settings, http=http)
    assert rec.of("semanticscholar")[0].headers["x-api-key"] == "secret-key"


async def test_s2_429_retries_then_falls_back_to_openalex():
    http, rec = make_http(s2=(429, {"message": "Too Many Requests"}), oa=(200, OA_WORKS))
    sleep = Sleeps()
    settings = Settings(_env_file=None, openalex_mailto="me@example.org")
    papers = await search_papers("solid electrolytes", 5, settings=settings, http=http, sleep=sleep)

    assert len(rec.of("semanticscholar")) == 4  # 1 try + 3 retries
    assert len(sleep.delays) == 3
    assert sleep.delays[0] < sleep.delays[1] < sleep.delays[2]  # backoff grows
    oa_req = rec.of("openalex")
    assert len(oa_req) == 1 and oa_req[0].url.params["mailto"] == "me@example.org"

    # the abstract-less work is gone; abstracts are rebuilt from the inverted index
    assert [p.id for p in papers] == ["oa_W111", "oa_W222"]
    first = papers[0]
    assert first.abstract == (
        "Solid electrolytes enable safer batteries. electrolytes Sulfide conduct well."
    )
    assert first.doi == "10.2/oa1"
    assert first.venue == "Nature Energy"
    assert first.authors_year == "Hopper, 2019"
    assert first.source == "openalex"


async def test_thin_s2_results_are_topped_up_from_openalex():
    thin = {"data": [S2_GOLDEN["data"][0]]}
    http, rec = make_http(s2=(200, thin), oa=(200, OA_WORKS))
    papers = await search_papers(
        "solid electrolytes", 6, settings=Settings(_env_file=None), http=http
    )
    ids = [p.id for p in papers]
    assert ids[0] == "s2_A1"
    assert "oa_W111" in ids
    assert "oa_W222" not in ids  # same DOI as s2_A1
    assert "oa_W333" not in ids  # no abstract
    assert len(rec.of("openalex")) == 1


async def test_both_sources_failing_raises_upstream_error():
    http, _ = make_http(s2=(500, {}), oa=(500, {}))
    with pytest.raises(UpstreamError):
        await search_papers("x", 5, settings=Settings(_env_file=None), http=http, sleep=Sleeps())
