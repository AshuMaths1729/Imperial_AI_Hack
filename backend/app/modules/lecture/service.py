"""Draft -> `Graph` mapping: ids, dedupe/merge, edge hygiene, cycle breaking, page clamping."""

from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any

from app.core.errors import SchemaValidationError
from app.modules.lecture.drafts import LectureDraft
from app.schemas.graph import (
    Edge,
    Graph,
    GraphMeta,
    Node,
    SourceRef,
    find_prerequisite_cycle,
)

log = logging.getLogger(__name__)


def normalise(label: str) -> str:
    s = unicodedata.normalize("NFKC", label).casefold()
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def _sha(text: str, n: int = 8) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:n]


def graph_id_for(doc_id: str) -> str:
    return f"g_{doc_id}"


def draft_to_graph(
    draft: LectureDraft,
    doc_id: str,
    page_count: int,
    *,
    created_at: datetime | None = None,
) -> Graph:
    # --- concepts: dedupe/merge by normalised label (and aliases) ----------------------
    merged: dict[str, dict[str, Any]] = {}  # canonical key -> {label, summary, page}
    index: dict[str, str] = {}  # any normalised label/alias -> canonical key
    for c in draft.concepts:
        key = normalise(c.label)
        if not key:
            continue
        alias_keys = [k for k in (normalise(a) for a in c.aliases) if k]
        target = index.get(key) or next((index[k] for k in alias_keys if k in index), None)
        page = min(max(c.page, 1), page_count)
        if target is None:
            target = key
            merged[key] = {"label": c.label.strip(), "summary": c.summary.strip(), "page": page}
        else:
            m = merged[target]
            if len(c.summary.strip()) > len(m["summary"]):
                m["summary"] = c.summary.strip()
            m["page"] = min(m["page"], page)
        for k in (key, *alias_keys):
            index.setdefault(k, target)
    if not merged:
        raise SchemaValidationError("Extraction produced no concepts")

    node_ids: dict[str, str] = {}
    used: set[str] = set()
    nodes: list[Node] = []
    for key, m in merged.items():
        n = 8
        nid = f"n_{_sha(doc_id + key, n)}"
        while nid in used:
            n += 4
            nid = f"n_{_sha(doc_id + key, n)}"
        used.add(nid)
        node_ids[key] = nid
        nodes.append(
            Node(
                id=nid,
                kind="concept",
                label=m["label"],
                summary=m["summary"],
                source_ref=SourceRef(doc_id=doc_id, page=m["page"]),
            )
        )

    # --- prerequisite edges: prerequisite (source) -> dependent (target) ---------------
    edges: list[Edge] = []
    seen: set[tuple[str, str]] = set()
    for p in draft.prerequisites:
        a, b = index.get(normalise(p.prerequisite)), index.get(normalise(p.dependent))
        if a is None or b is None or a == b:
            continue  # dangling or self-loop
        src, dst = node_ids[a], node_ids[b]
        if (src, dst) in seen:
            continue
        seen.add((src, dst))
        edge_id = f"e_{_sha(f'{src}>{dst}:prerequisite')}"
        edges.append(Edge(id=edge_id, source=src, target=dst, type="prerequisite"))

    meta = GraphMeta(extractor_used="frontier", created_at=created_at or datetime.now(UTC))
    gid = graph_id_for(doc_id)

    def probe() -> list[str] | None:
        # model_construct skips the integrity validator (which rejects cycles) so we can fix them
        unchecked = Graph.model_construct(
            graph_id=gid, kind="lecture", nodes=nodes, edges=edges, meta=meta
        )
        return find_prerequisite_cycle(unchecked)

    while (cycle := probe()) is not None:
        a, b = cycle[-2], cycle[-1]  # the back edge that closes the cycle
        log.info("breaking prerequisite cycle by dropping %s -> %s", a, b)
        edges = [e for e in edges if (e.source, e.target) != (a, b)]

    return Graph(graph_id=gid, kind="lecture", nodes=nodes, edges=edges, meta=meta)
