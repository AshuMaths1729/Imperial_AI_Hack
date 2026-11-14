import type { GraphEdgeData, GraphNodeData } from "../types/scholartwin";

export interface GraphCitation {
  id: string;
  nodeId?: string;
  title: string;
  citation: string;
  docId?: string;
  url?: string;
  evidenceCount: number;
  isDetached?: boolean;
}

const NEW_ARXIV_RE = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const OLD_ARXIV_RE = /^[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?$/i;
const DOI_RE = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)$/i;

export function parseArxivId(raw?: string | null): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();
      if (host !== "arxiv.org" && host !== "www.arxiv.org" && host !== "export.arxiv.org") {
        return null;
      }
      const m = u.pathname.match(/^\/(?:abs|pdf|html|e-print|format)\/(.+?)(?:\.pdf)?\/?$/i);
      if (!m) return null;
      s = m[1];
    } catch {
      return null;
    }
  }

  // Backend stores arXiv paper IDs as `arxiv_<id>` with `/` replaced by `_`
  if (/^arxiv_/i.test(s)) {
    s = s.slice(6);
    if (!NEW_ARXIV_RE.test(s) && s.includes("_")) {
      const idx = s.lastIndexOf("_");
      s = `${s.slice(0, idx)}/${s.slice(idx + 1)}`;
    }
  } else {
    s = s.replace(/^arxiv\s*:\s*/i, "");
  }

  if (NEW_ARXIV_RE.test(s) || OLD_ARXIV_RE.test(s)) {
    return s;
  }
  return null;
}

export function formatArxivUrl(arxivId: string): string {
  return `https://arxiv.org/abs/${arxivId}`;
}

export function resolveProviderUrl(docId?: string | null): string | undefined {
  const s = docId?.trim();
  if (!s) return undefined;

  if (/^https?:\/\//i.test(s)) return s;

  const aid = parseArxivId(s);
  if (aid) return formatArxivUrl(aid);

  const doiMatch = s.match(DOI_RE);
  if (doiMatch) return `https://doi.org/${doiMatch[1]}`;

  if (/^oa_/i.test(s)) {
    const oid = s.slice(3).trim();
    if (oid) return `https://openalex.org/${oid}`;
  }

  if (/^s2_/i.test(s)) {
    const pid = s.slice(3).trim();
    if (pid) return `https://www.semanticscholar.org/paper/${pid}`;
  }

  if (/^epmc_/i.test(s)) {
    const pid = s.slice(5).trim();
    if (pid) {
      if (/^PMC\d+/i.test(pid)) return `https://europepmc.org/article/PMC/${pid}`;
      if (/^\d+$/.test(pid)) return `https://europepmc.org/article/MED/${pid}`;
      return `https://europepmc.org/search?query=${encodeURIComponent(pid)}`;
    }
  }

  return undefined;
}

export function formatCitationLabel(raw?: string | null): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  const aid = parseArxivId(s);
  if (aid) return `arXiv:${aid}`;
  if (/^oa_/i.test(s)) return `OpenAlex:${s.slice(3)}`;
  if (/^s2_/i.test(s)) return `SemanticScholar:${s.slice(3, 11)}`;
  if (/^epmc_/i.test(s)) return `EuropePMC:${s.slice(5)}`;
  return s;
}

export function resolveCitationUrl(opts: {
  docId?: string;
  citation?: string;
  title?: string;
}): string | undefined {
  const fromDoc = resolveProviderUrl(opts.docId);
  if (fromDoc) return fromDoc;

  const fromCitation = resolveProviderUrl(opts.citation);
  if (fromCitation) return fromCitation;

  const parts = [opts.title?.trim(), opts.citation?.trim()].filter(
    (p): p is string => Boolean(p && !/^p_[a-z0-9_]+$/i.test(p))
  );
  const query = Array.from(new Set(parts)).join(" ");
  if (query) {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
  }
  return undefined;
}

export function extractGraphCitations(
  nodes: GraphNodeData[],
  edges: GraphEdgeData[]
): GraphCitation[] {
  const evidenceByPaper = new Map<string, number>();
  const connectedIds = new Set<string>();
  for (const edge of edges) {
    connectedIds.add(edge.source);
    connectedIds.add(edge.target);
    for (const ev of edge.evidence ?? []) {
      evidenceByPaper.set(ev.paper_id, (evidenceByPaper.get(ev.paper_id) ?? 0) + 1);
    }
  }

  const out: GraphCitation[] = [];
  const seenKeys = new Set<string>();

  for (const node of nodes) {
    const rawCitation = node.authors_year || node.slide_ref;
    if (!rawCitation && node.category !== "paper" && !node.doc_id) continue;

    const key = node.doc_id || rawCitation || node.id;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const formattedCitation = formatCitationLabel(rawCitation || node.doc_id) || node.label;
    const evidenceCount = node.doc_id ? evidenceByPaper.get(node.doc_id) ?? 0 : 0;
    const isDetached = edges.length > 0 && !connectedIds.has(node.id);

    out.push({
      id: `cit-${node.id}`,
      nodeId: node.id,
      title: node.label,
      citation: formattedCitation,
      docId: node.doc_id || (node.category === "paper" ? node.id : undefined),
      url: resolveCitationUrl({
        docId: node.doc_id || (node.category === "paper" ? node.id : undefined),
        citation: rawCitation,
        title: node.label,
      }),
      evidenceCount,
      isDetached,
    });
  }

  // Include any edge evidence paper_ids not already matched to a node
  for (const [paperId, count] of evidenceByPaper.entries()) {
    if (seenKeys.has(paperId)) continue;
    seenKeys.add(paperId);
    const formatted = formatCitationLabel(paperId) || paperId;
    out.push({
      id: `cit-ev-${paperId}`,
      title: formatted,
      citation: formatted,
      docId: paperId,
      url: resolveCitationUrl({ docId: paperId, citation: paperId }),
      evidenceCount: count,
    });
  }

  return out;
}
