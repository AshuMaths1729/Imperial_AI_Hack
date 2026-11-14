"""HypothesisGraph pipeline: search, claims, normalize, cluster, compare, assemble.

Synchronous (one `build_topic_graph` call returns the finished graph). Every LLM call goes
through `llm.parse`; paper text is wrapped as untrusted data in the prompts.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.core.errors import AppError, NotFound, OfflineCacheMiss
from app.llm.client import LLMClient
from app.modules.hypothesis.prompts import (
    CLAIMS_PROMPT,
    COMPARE_PROMPT,
    NORMALIZE_PROMPT,
    PROMPT_VERSION,
)
from app.modules.hypothesis.schemas import (
    ClaimDraft,
    CompareDraft,
    NormalizeDraft,
    PaperClaimsDraft,
    PaperOut,
    TopicResult,
    TopicStats,
)
from app.schemas.graph import Edge, Evidence, Graph, GraphMeta, Node, SourceRef
from app.settings import Settings
from app.tools.scholarly import Paper, search_papers
from app.tools.scholarly.s2 import Sleep

log = logging.getLogger(__name__)

MAX_CLAIMS_PER_PAPER = 4
MAX_CLUSTERS = 8
MIN_TIER1_CLUSTERS = 3
MAX_CLAIMS_PER_CLUSTER = 8
CONCURRENCY = 6
_SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]+$")


@dataclass
class ClaimRec:
    node_id: str
    paper: Paper
    draft: ClaimDraft
    entity_key: str = ""
    property_key: str = ""


@dataclass
class Cluster:
    key: tuple[str, str]
    claims: list[ClaimRec] = field(default_factory=list)

    @property
    def n_papers(self) -> int:
        return len({c.paper.id for c in self.claims})


# --- helpers ------------------------------------------------------------------------------


def _ws(text: str) -> str:
    return " ".join(text.split())


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:30] or "topic"


def _hash(*parts: str, n: int = 8) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:n]


def topic_graph_id(query: str, max_papers: int) -> str:
    q = _ws(query).lower()
    return f"g_topic_{_slug(q)}_{_hash(q, str(max_papers))}"


def quote_in_paper(quote: str, paper: Paper) -> bool:
    q = _ws(quote)
    return bool(q) and any(q in _ws(t) for t in paper.texts())


def _graphs_dir(settings: Settings) -> Path:
    return settings.state_dir / "graphs"


def _papers_dir(settings: Settings) -> Path:
    return settings.state_dir / "papers"


def paper_block(paper: Paper) -> str:
    parts = [f'<paper id="{paper.id}" authors="{paper.authors_year}">', f"Title: {paper.title}"]
    if paper.abstract:
        parts.append(f"<abstract>\n{paper.abstract}\n</abstract>")
    if paper.tldr:
        parts.append(f"<tldr>\n{paper.tldr}\n</tldr>")
    parts.append("</paper>")
    return "\n".join(parts)


# --- stages -------------------------------------------------------------------------------


async def extract_claims(llm: LLMClient, papers: list[Paper]) -> list[ClaimRec]:
    """One `hypothesis.claims` call per paper (Semaphore(6)); unverifiable quotes are dropped."""
    sem = asyncio.Semaphore(CONCURRENCY)
    errors: list[Exception] = []

    async def one(paper: Paper) -> list[ClaimRec]:
        async with sem:
            try:
                res = await llm.parse(
                    "hypothesis.claims",
                    CLAIMS_PROMPT,
                    paper_block(paper),
                    PaperClaimsDraft,
                    prompt_version=PROMPT_VERSION,
                )
            except AppError as exc:
                log.warning("claim extraction failed for %s: %s", paper.id, exc.message)
                errors.append(exc)
                return []
        recs: list[ClaimRec] = []
        for draft in res.output.claims[:MAX_CLAIMS_PER_PAPER]:
            if not (draft.entity.strip() and draft.property.strip()):
                continue
            if not quote_in_paper(draft.quote, paper):
                log.info("dropping claim with unverifiable quote in %s", paper.id)
                continue
            recs.append(ClaimRec(f"c_{paper.id}_{len(recs)}", paper, draft))
        return recs

    per_paper = await asyncio.gather(*(one(p) for p in papers))
    claims = [c for recs in per_paper for c in recs]
    if not claims and errors:
        raise errors[0]
    return claims


def _key(text: str) -> str:
    return _ws(text).lower()


async def normalize(llm: LLMClient, claims: list[ClaimRec]) -> None:
    """ONE call over every claim's (entity, property); sets canonical keys in place."""
    for c in claims:  # fallback keys if the model skips an index
        c.entity_key, c.property_key = _key(c.draft.entity), _key(c.draft.property)
    if not claims:
        return
    listing = "\n".join(
        f"{i} | {c.draft.entity} | {c.draft.property}" for i, c in enumerate(claims)
    )
    try:
        res = await llm.parse(
            "hypothesis.claims",
            NORMALIZE_PROMPT,
            f"<claims>\n{listing}\n</claims>",
            NormalizeDraft,
            prompt_version=PROMPT_VERSION,
        )
    except AppError as exc:
        log.warning("normalization failed, using raw strings: %s", exc.message)
        return
    for item in res.output.items:
        if 0 <= item.index < len(claims) and item.entity_key.strip() and item.property_key.strip():
            claims[item.index].entity_key = _key(item.entity_key)
            claims[item.index].property_key = _key(item.property_key)


def cluster_claims(claims: list[ClaimRec]) -> list[Cluster]:
    """Group claims that could be compared; keep clusters spanning >= 2 papers.

    Tier 1 groups by canonical (entity, property). When that yields fewer than
    MIN_TIER1_CLUSTERS clusters (diverse corpora rarely share both keys), tier 2 adds clusters by
    property alone (key = ("*", property)) so cross-paper contradictions can still be found.
    """
    groups: dict[tuple[str, str], Cluster] = {}
    for c in claims:
        key = (c.entity_key, c.property_key)
        groups.setdefault(key, Cluster(key)).claims.append(c)
    chosen = [g for g in groups.values() if g.n_papers >= 2]
    chosen.sort(key=lambda g: (-len(g.claims), g.key))
    chosen = chosen[:MAX_CLUSTERS]

    if len(chosen) < MIN_TIER1_CLUSTERS:
        by_prop: dict[str, Cluster] = {}
        for c in claims:
            by_prop.setdefault(c.property_key, Cluster(("*", c.property_key))).claims.append(c)
        covered = [{id(c) for c in g.claims} for g in chosen]
        extra = [
            g
            for g in by_prop.values()
            if g.n_papers >= 2 and not any({id(c) for c in g.claims} <= s for s in covered)
        ]
        extra.sort(key=lambda g: (-len(g.claims), g.key))
        chosen += extra[: MAX_CLUSTERS - len(chosen)]
    return chosen


def _claim_line(i: int, c: ClaimRec) -> str:
    d = c.draft
    return (
        f"[{i}] paper={c.paper.authors_year or c.paper.id} | {d.entity} / {d.property} | "
        f"direction={d.direction} | value={d.value or '-'} | condition={d.condition or '-'} | "
        f'quote="{_ws(d.quote)}"'
    )


async def compare_cluster(llm: LLMClient, cluster: Cluster) -> CompareDraft | None:
    members = cluster.claims[:MAX_CLAIMS_PER_CLUSTER]
    listing = "\n".join(_claim_line(i, c) for i, c in enumerate(members))
    try:
        res = await llm.parse(
            "hypothesis.compare",
            COMPARE_PROMPT,
            f"<claims>\n{listing}\n</claims>",
            CompareDraft,
            prompt_version=PROMPT_VERSION,
        )
    except AppError as exc:
        log.warning("compare failed for %s: %s", cluster.key, exc.message)
        return None
    return res.output


# --- assembly -----------------------------------------------------------------------------


def _claim_node(c: ClaimRec) -> Node:
    d = c.draft
    label = f"{d.entity}: {d.property}" + (f" ({d.value})" if d.value else "")
    summary = f'"{_ws(d.quote)}"' + (f" [condition: {d.condition}]" if d.condition else "")
    return Node(
        id=c.node_id,
        kind="claim",
        label=label[:140],
        summary=summary,
        source_ref=SourceRef(doc_id=c.paper.id),
    )


def _paper_node(p: Paper) -> Node:
    meta = " · ".join(x for x in (p.venue, str(p.year) if p.year else "") if x)
    return Node(
        id=p.id,
        kind="paper",
        label=p.title[:140],
        summary=meta,
        source_ref=SourceRef(doc_id=p.id),
        authors_year=p.authors_year or None,
    )


def _verified(quote: str, paper: Paper, fallback: str) -> str:
    return _ws(quote) if quote_in_paper(quote, paper) else _ws(fallback)


def assemble(
    graph_id: str, clusters: list[Cluster], drafts: list[CompareDraft | None]
) -> tuple[Graph, TopicStats]:
    nodes: dict[str, Node] = {}
    edges: dict[str, Edge] = {}
    n_sup = n_con = n_gap = 0

    for cluster, draft in zip(clusters, drafts, strict=True):
        members = cluster.claims[:MAX_CLAIMS_PER_CLUSTER]
        for c in members:
            nodes.setdefault(c.paper.id, _paper_node(c.paper))
            nodes.setdefault(c.node_id, _claim_node(c))
        if draft is None:
            continue

        for rel in draft.relations:
            if not (0 <= rel.claim_a < len(members) and 0 <= rel.claim_b < len(members)):
                continue
            a, b = members[rel.claim_a], members[rel.claim_b]
            if a.paper.id == b.paper.id:
                continue
            eid = f"e_{rel.relation}_{a.node_id}_{b.node_id}"
            if eid in edges or f"e_{rel.relation}_{b.node_id}_{a.node_id}" in edges:
                continue
            edges[eid] = Edge(
                id=eid,
                source=a.node_id,
                target=b.node_id,
                type=rel.relation,
                condition=rel.condition.strip() or None,
                evidence=[
                    Evidence(
                        paper_id=a.paper.id, quote=_verified(rel.quote_a, a.paper, a.draft.quote)
                    ),
                    Evidence(
                        paper_id=b.paper.id, quote=_verified(rel.quote_b, b.paper, b.draft.quote)
                    ),
                ],
                confidence=min(1.0, max(0.0, rel.confidence)),
            )
            if rel.relation == "supports":
                n_sup += 1
            else:
                n_con += 1

        gap = draft.gap
        if gap and gap.condition.strip():
            anchors = [i for i in gap.related_claims if 0 <= i < len(members)]
            anchor = members[anchors[0] if anchors else 0]
            gid = f"gap_{_hash(graph_id, *cluster.key, gap.condition)}"
            nodes[gid] = Node(
                id=gid,
                kind="claim",
                label=f"Untested: {gap.condition.strip()}"[:140],
                summary=gap.rationale.strip(),
            )
            edges[f"e_{gid}"] = Edge(
                id=f"e_{gid}",
                source=anchor.node_id,
                target=gid,
                type="gap",
                condition=gap.condition.strip(),
                confidence=0.5,
            )
            n_gap += 1

    graph = Graph(
        graph_id=graph_id,
        kind="hypothesis",
        nodes=list(nodes.values()),
        edges=list(edges.values()),
        meta=GraphMeta(extractor_used="frontier", created_at=datetime.now(UTC)),
    )
    stats = TopicStats(
        papers_found=0,
        papers_with_claims=sum(1 for n in graph.nodes if n.kind == "paper"),
        claims=sum(1 for n in graph.nodes if n.kind == "claim" and not n.id.startswith("gap_")),
        clusters=len(clusters),
        supports=n_sup,
        contradicts=n_con,
        gaps=n_gap,
    )
    return graph, stats


# --- persistence --------------------------------------------------------------------------


def save_graph(settings: Settings, graph: Graph) -> Path:
    path = _graphs_dir(settings) / f"{graph.graph_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(graph.model_dump_json(indent=2), encoding="utf-8")
    return path


def save_papers(settings: Settings, papers: list[Paper]) -> None:
    folder = _papers_dir(settings)
    folder.mkdir(parents=True, exist_ok=True)
    for p in papers:
        (folder / f"{p.id}.json").write_text(
            PaperOut(**p.model_dump(include=set(PaperOut.model_fields))).model_dump_json(indent=2),
            encoding="utf-8",
        )


def load_paper(settings: Settings, paper_id: str) -> PaperOut:
    path = _papers_dir(settings) / f"{paper_id}.json"
    if not _SAFE_ID.match(paper_id) or not path.is_file():
        raise NotFound(f"paper {paper_id!r} not found")
    return PaperOut.model_validate(json.loads(path.read_text(encoding="utf-8")))


# --- entry point --------------------------------------------------------------------------


async def build_topic_graph(
    query: str,
    max_papers: int,
    *,
    llm: LLMClient,
    settings: Settings,
    http: httpx.AsyncClient | None = None,
    sleep: Sleep = asyncio.sleep,
) -> TopicResult:
    graph_id = topic_graph_id(query, max_papers)

    if settings.is_offline:  # never go live: serve the stored graph or fail loudly
        path = _graphs_dir(settings) / f"{graph_id}.json"
        if not path.is_file():
            raise OfflineCacheMiss(f"no stored topic graph {graph_id} (offline mode)")
        graph = Graph.model_validate_json(path.read_text(encoding="utf-8"))
        return TopicResult(graph_id=graph_id, graph=graph, stats=_stats_of(graph))

    papers = await search_papers(query, max_papers, settings=settings, http=http, sleep=sleep)
    if not papers:
        raise NotFound(f"no papers found for {query!r}")
    save_papers(settings, papers)

    claims = await extract_claims(llm, papers)
    await normalize(llm, claims)
    clusters = cluster_claims(claims)
    drafts = await asyncio.gather(*(compare_cluster(llm, c) for c in clusters))

    graph, stats = assemble(graph_id, clusters, list(drafts))
    stats.papers_found = len(papers)
    save_graph(settings, graph)
    return TopicResult(graph_id=graph_id, graph=graph, stats=stats)


def _stats_of(graph: Graph) -> TopicStats:
    kinds = [e.type for e in graph.edges]
    papers = sum(1 for n in graph.nodes if n.kind == "paper")
    return TopicStats(
        papers_found=papers,
        papers_with_claims=papers,
        claims=sum(1 for n in graph.nodes if n.kind == "claim" and not n.id.startswith("gap_")),
        clusters=0,
        supports=kinds.count("supports"),
        contradicts=kinds.count("contradicts"),
        gaps=kinds.count("gap"),
    )
