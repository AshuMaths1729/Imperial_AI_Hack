from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.errors import OfflineCacheMiss
from app.deps import get_llm
from app.llm.testing import FakeLLM
from app.main import create_app
from app.modules.hypothesis.router import get_scholarly_http
from app.modules.hypothesis.service import build_topic_graph, quote_in_paper, topic_graph_id
from app.schemas.graph import Graph
from app.settings import Settings
from app.tools.scholarly import Paper
from tests.scholarly_fixtures import A_ABS, B_ABS, C_ABS, D_ABS, make_http

QUERY = "solid-state battery electrolytes"

A_QUOTE = "Li6PS5Cl reaches an ionic conductivity of 5 mS/cm at room temperature"
B_QUOTE = "Li6PS5Cl shows an ionic conductivity of only 0.5 mS/cm after humid air exposure"
C_QUOTE = "LLZO garnet is stable against lithium metal up to 5 V"
D_QUOTE = (
    "LLZO garnet suffers from lithium dendrites along grain boundaries at high current density"
)


def claim(entity, prop, direction, value, condition, quote):
    return {
        "entity": entity,
        "property": prop,
        "direction": direction,
        "value": value,
        "condition": condition,
        "quote": quote,
    }


def golden_llm() -> FakeLLM:
    llm = FakeLLM()
    # per-paper claim calls (paper order A, B, C, D), then the single normalize call
    llm.queue(
        "hypothesis.claims",
        {
            "claims": [
                claim(
                    "Li6PS5Cl",
                    "ionic conductivity",
                    "positive",
                    "5 mS/cm",
                    "room temperature",
                    A_QUOTE,
                ),
                claim(
                    "Li6PS5Cl",
                    "stability",
                    "positive",
                    "",
                    "",
                    "This sentence is not in the abstract",
                ),
            ]
        },
        {
            "claims": [
                claim(
                    "argyrodite Li6PS5Cl",
                    "conductivity",
                    "negative",
                    "0.5 mS/cm",
                    "after humid air exposure",
                    B_QUOTE,
                )
            ]
        },
        {
            "claims": [
                claim("LLZO garnet", "stability vs Li metal", "positive", "", "up to 5 V", C_QUOTE)
            ]
        },
        {
            "claims": [
                claim(
                    "LLZO", "lithium stability", "negative", "", "at high current density", D_QUOTE
                )
            ]
        },
        # normalize: indices are over the VERIFIED claims, in order: A0, B0, C0, D0
        {
            "items": [
                {"index": 0, "entity_key": "Li6PS5Cl", "property_key": "ionic conductivity"},
                {"index": 1, "entity_key": "li6ps5cl", "property_key": "Ionic Conductivity"},
                {
                    "index": 2,
                    "entity_key": "LLZO",
                    "property_key": "stability against lithium metal",
                },
                {
                    "index": 3,
                    "entity_key": "llzo",
                    "property_key": "stability against lithium metal",
                },
            ]
        },
    )
    llm.queue(
        "hypothesis.compare",
        {  # cluster li6ps5cl
            "relations": [
                {
                    "claim_a": 0,
                    "claim_b": 1,
                    "relation": "contradicts",
                    "condition": "dry vs humid air exposure",
                    "quote_a": A_QUOTE,
                    "quote_b": "a quote the model invented",
                    "confidence": 0.9,
                }
            ],
            "gap": {
                "condition": "humid air exposure at elevated temperature",
                "rationale": "No paper tests humidity together with heating.",
                "related_claims": [0, 1],
            },
        },
        {  # cluster llzo
            "relations": [
                {
                    "claim_a": 0,
                    "claim_b": 1,
                    "relation": "contradicts",
                    "condition": "low vs high current density",
                    "quote_a": C_QUOTE,
                    "quote_b": D_QUOTE,
                    "confidence": 0.7,
                },
                {  # out of range: ignored
                    "claim_a": 0,
                    "claim_b": 9,
                    "relation": "supports",
                    "condition": "",
                    "quote_a": "",
                    "quote_b": "",
                    "confidence": 1.0,
                },
            ],
            "gap": None,
        },
    )
    return llm


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(_env_file=None, s2_api_key="test-key", state_dir=tmp_path / "state")


def test_quote_must_be_verbatim_substring_modulo_whitespace():
    paper = Paper(id="p", title="t", abstract="Alpha  beta\ngamma delta.", tldr="Short TLDR here.")
    assert quote_in_paper("Alpha beta gamma", paper)
    assert quote_in_paper("TLDR here", paper)
    assert not quote_in_paper("alpha beta", paper)  # case matters
    assert not quote_in_paper("Alpha delta", paper)
    assert not quote_in_paper("", paper)


async def test_golden_pipeline(settings):
    http, rec = make_http()
    llm = golden_llm()
    result = await build_topic_graph(QUERY, 4, llm=llm, settings=settings, http=http)
    graph = result.graph

    assert graph.kind == "hypothesis"
    assert graph.graph_id == result.graph_id == topic_graph_id(QUERY, 4)
    assert graph.graph_id.startswith("g_topic_solid-state-battery-")

    # calls: 4 claims + 1 normalize + 2 compare
    routes = [c.route for c in llm.calls]
    assert routes.count("hypothesis.claims") == 5
    assert routes.count("hypothesis.compare") == 2
    claim_calls = [c for c in llm.calls if c.route == "hypothesis.claims"][:4]
    assert all("<abstract>" in c.content for c in claim_calls)  # abstract is wrapped as data
    assert "untrusted" in claim_calls[0].prompt

    # integrity (the Graph validator already enforces endpoints) + node kinds
    papers = [n for n in graph.nodes if n.kind == "paper"]
    claims = [n for n in graph.nodes if n.kind == "claim"]
    assert {p.id for p in papers} == {"s2_A1", "s2_B2", "s2_C3", "s2_D4"}
    assert papers[0].authors_year
    assert len(claims) == 4 + 1  # 4 verified claims + the gap node
    assert not any("not in the abstract" in n.summary for n in graph.nodes)  # bad quote dropped
    paper_ids = {p.id for p in papers}
    assert all(n.source_ref.doc_id in paper_ids for n in claims if n.source_ref)

    # contradicts with a condition, evidence quotes verified against abstracts
    contradicts = [e for e in graph.edges if e.type == "contradicts"]
    assert len(contradicts) == 2
    by_cond = {e.condition: e for e in contradicts}
    edge = by_cond["dry vs humid air exposure"]
    assert edge.source == "c_s2_A1_0" and edge.target == "c_s2_B2_0"
    texts = {"s2_A1": A_ABS, "s2_B2": B_ABS, "s2_C3": C_ABS, "s2_D4": D_ABS}
    for e in contradicts:
        assert len(e.evidence) == 2
        for ev in e.evidence:
            assert ev.quote in texts[ev.paper_id]  # invented quote replaced by the claim quote
    assert edge.evidence[1].quote == B_QUOTE
    assert 0 <= edge.confidence <= 1

    # exactly one gap edge pointing at an "Untested: ..." node
    gaps = [e for e in graph.edges if e.type == "gap"]
    assert len(gaps) == 1
    gap_node = next(n for n in graph.nodes if n.id == gaps[0].target)
    assert gap_node.label == "Untested: humid air exposure at elevated temperature"
    assert gaps[0].condition == "humid air exposure at elevated temperature"

    assert result.stats.contradicts == 2 and result.stats.gaps == 1
    assert result.stats.papers_found == 4 and result.stats.clusters == 2

    # persisted for the shared GET /api/graphs/{id}, papers for GET /api/papers/{id}
    stored = settings.state_dir / "graphs" / f"{graph.graph_id}.json"
    assert Graph.model_validate_json(stored.read_text(encoding="utf-8")) == graph
    assert (settings.state_dir / "papers" / "s2_A1.json").is_file()
    assert len(rec.of("semanticscholar")) == 1


async def test_failed_normalize_falls_back_to_raw_keys(settings):
    """If the normalize call fails, identical raw (entity, property) strings still cluster."""
    http, _ = make_http()
    llm = FakeLLM().queue(
        "hypothesis.claims",
        {"claims": [claim("Li6PS5Cl", "ionic conductivity", "positive", "5", "", A_QUOTE)]},
        {"claims": [claim("Li6PS5Cl", "ionic conductivity", "negative", "0.5", "", B_QUOTE)]},
        {"claims": []},
        {"claims": []},
        {"bogus": "does not match NormalizeDraft"},
    )
    llm.queue("hypothesis.compare", {"relations": [], "gap": None})
    result = await build_topic_graph(QUERY, 4, llm=llm, settings=settings, http=http)
    assert result.stats.clusters == 1
    assert result.stats.claims == 2


async def test_offline_mode_serves_stored_graph_or_fails(tmp_path):
    online = Settings(_env_file=None, s2_api_key="test-key", state_dir=tmp_path / "state")
    offline = Settings(
        _env_file=None, s2_api_key="test-key", state_dir=tmp_path / "state", cache_mode="offline"
    )
    with pytest.raises(OfflineCacheMiss):
        await build_topic_graph(QUERY, 4, llm=FakeLLM(), settings=offline)

    http, _ = make_http()
    first = await build_topic_graph(QUERY, 4, llm=golden_llm(), settings=online, http=http)
    again = await build_topic_graph(QUERY, 4, llm=FakeLLM(), settings=offline)
    assert again.graph == first.graph


def test_endpoints(settings):
    app = create_app(settings)
    http, _ = make_http()
    app.dependency_overrides[get_llm] = golden_llm
    app.dependency_overrides[get_scholarly_http] = lambda: http
    with TestClient(app) as client:
        r = client.post("/api/topics", json={"query": QUERY, "max_papers": 4})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["graph_id"] == body["graph"]["graph_id"]
        assert body["graph"]["kind"] == "hypothesis"
        assert any(e["type"] == "contradicts" and e["condition"] for e in body["graph"]["edges"])

        p = client.get("/api/papers/s2_A1")
        assert p.status_code == 200
        assert p.json()["title"] == "Argyrodite sulfide electrolytes"
        assert p.json()["abstract"] == A_ABS
        assert p.json()["doi"] == "10.1/a"

        assert client.get("/api/papers/s2_nope").status_code == 404
        assert client.get("/api/papers/bad.id").status_code == 404
        assert client.post("/api/topics", json={"query": "x"}).status_code == 422
