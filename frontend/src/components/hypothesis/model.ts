/**
 * View model for a HypothesisGraph topic.
 *
 * The backend returns papers, claims (each tied to its paper by `doc_id`) and open-question
 * nodes, with links only between claims. The user thinks in papers, so this module turns it into:
 *  - one node per **paper** (its claims live inside it and are listed in its details),
 *  - one node per **open question**, linked from the paper whose claim raises it,
 *  - one **supports** / **contradicts** line between two papers whenever any of their claims
 *    support / contradict each other (the claim-level reasons are kept for the details bubble),
 *  - papers with no links stay on their own.
 * Then it lays the graph out top-to-bottom (dagre), with unlinked papers in a row underneath.
 * It works on saved topics too.
 */
import dagre from "@dagrejs/dagre";
import type { GraphEdgeData, GraphNodeData, WorkspaceDataset } from "../../types/scholartwin";
import { formatCitationLabel } from "../../api/citations";

/** "claim" only for a claim whose paper isn't in the graph (it then stands in for its paper). */
export type NodeKind = "paper" | "claim" | "gap";

/** One claim-level link behind a paper-level line. */
export interface ClaimLink {
  edge: GraphEdgeData;
  from: GraphNodeData;
  to: GraphNodeData;
}

/** One thing a claim is linked to: another paper's claim, or an open question it raises. */
export interface ClaimRelation {
  type: GraphEdgeData["type"];
  /** The node on the graph at the other end (a paper or an open question). */
  other: GraphNodeData;
  /** The other paper's claim, for supports / contradicts. */
  otherClaim?: GraphNodeData;
  /** The drawn line this link is part of. */
  line: GraphEdgeData;
}

export interface HypothesisModel {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  byId: Map<string, GraphNodeData>;
  kind: (id: string) => NodeKind;
  /** Every claim, in paper order. */
  claims: GraphNodeData[];
  /** Claims made by each paper. */
  claimsOf: Map<string, GraphNodeData[]>;
  /** What each claim is linked to. */
  claimLinks: Map<string, ClaimRelation[]>;
  /** The claim-level links merged into each drawn line. */
  linksOf: Map<string, ClaimLink[]>;
  /** Maps any original id (e.g. a claim) to the node that shows it, or null. */
  resolveId: (id: string | null | undefined) => string | null;
  /** Whether a node has at least one line. */
  isLinked: (id: string) => boolean;
  counts: { paper: number; claim: number; supports: number; contradicts: number; gap: number; unlinked: number };
}

const isGapNode = (n: GraphNodeData) =>
  n.category === "gap" || n.id.startsWith("gap_") || /^untested\b/i.test(n.label);

const NODE_W = 220; // GraphCanvas node width

function estimateHeight(n: GraphNodeData, kind: NodeKind): number {
  const lines = Math.max(1, Math.ceil(n.label.length / 27));
  let h = 24 + lines * 17;
  if (n.authors_year || n.slide_ref) h += 19;
  if (kind === "gap") h += 18; // "Open question" tag
  if (kind === "paper") h += 19; // "n claims" line
  return h;
}

/**
 * The paper a claim comes from. New topics carry it in `doc_id`; topics saved by older builds
 * only have it in `authors_year` (the raw paper id) or in the claim id itself (`c_<paper>_<n>`).
 */
function sourceOf(n: GraphNodeData): string | undefined {
  if (n.doc_id) return n.doc_id;
  if (n.authors_year && /^(oa|s2|epmc|arxiv)_/i.test(n.authors_year)) return n.authors_year;
  return /^c_(.+)_\d+$/.exec(n.id)?.[1];
}

export function buildHypothesisModel(dataset: WorkspaceDataset): HypothesisModel {
  const original = new Map(dataset.nodes.map((n) => [n.id, n]));
  const papers = dataset.nodes.filter((n) => n.category === "paper");

  // Claims whose paper isn't in the graph get a stand-in paper, so no claim floats on its own.
  const paperNodes = new Map(papers.map((p) => [p.id, p]));
  for (const n of dataset.nodes) {
    if (n.category === "paper" || isGapNode(n)) continue;
    const src = sourceOf(n);
    if (src && !paperNodes.has(src)) {
      paperNodes.set(src, {
        id: src,
        category: "paper",
        label: formatCitationLabel(src) ?? src,
        summary: "",
        doc_id: src,
        mastery: 0,
        x: 0,
        y: 0,
        quiz: [],
      });
    }
  }

  // Where each original node is shown: claims inside their paper, everything else as itself.
  const holder = new Map<string, string>();
  const claimsOf = new Map<string, GraphNodeData[]>();
  const kinds = new Map<string, NodeKind>();
  const shown: GraphNodeData[] = [];
  const claims: GraphNodeData[] = [];
  const addPaper = (p: GraphNodeData) => {
    if (kinds.has(p.id)) return;
    holder.set(p.id, p.id);
    kinds.set(p.id, "paper");
    shown.push(p);
  };
  for (const n of dataset.nodes) {
    if (n.category === "paper") {
      addPaper(n);
    } else if (isGapNode(n)) {
      holder.set(n.id, n.id);
      kinds.set(n.id, "gap");
      shown.push({ ...n, category: "gap", label: n.label.replace(/^untested\s*:\s*/i, "").trim() || n.label });
    } else {
      const src = sourceOf(n);
      const paper = src ? paperNodes.get(src) : undefined;
      if (paper) {
        addPaper(paper);
        holder.set(n.id, paper.id);
        claimsOf.set(paper.id, [...(claimsOf.get(paper.id) ?? []), n]);
      } else {
        // No source at all: the claim has to stand in for its own paper.
        holder.set(n.id, n.id);
        kinds.set(n.id, "claim");
        shown.push(n);
      }
    }
  }
  for (const list of claimsOf.values()) claims.push(...list);

  // Merge claim-level links into one line per paper pair (per type), and paper -> open question.
  const merged = new Map<string, GraphEdgeData>();
  const linksOf = new Map<string, ClaimLink[]>();
  const rawLinks: {
    e: GraphEdgeData;
    a: string;
    b: string;
    from: GraphNodeData;
    to: GraphNodeData;
    line: GraphEdgeData;
    toGap: boolean;
  }[] = [];
  for (const e of dataset.edges) {
    const a = holder.get(e.source);
    const b = holder.get(e.target);
    const from = original.get(e.source);
    const to = original.get(e.target);
    if (!a || !b || !from || !to || a === b) continue; // claims linked within one paper
    const toGap = kinds.get(b) === "gap";
    const key = toGap ? `gap:${a}>${b}` : `${e.type}:${[a, b].sort().join("|")}`;
    let line = merged.get(key);
    if (!line) {
      line = { id: `pg-${merged.size}`, source: a, target: b, type: toGap ? "gap" : e.type, evidence: [] };
      merged.set(key, line);
      linksOf.set(line.id, []);
    }
    line.evidence = [...(line.evidence ?? []), ...(e.evidence ?? [])];
    line.label = line.label ?? e.label ?? e.condition;
    linksOf.get(line.id)!.push({ edge: e, from, to });
    rawLinks.push({ e, a, b, from, to, line, toGap });
  }
  const edges = [...merged.values()];

  // Layout: each linked cluster top-to-bottom with dagre, clusters packed into rows (so many
  // small clusters don't become one very wide strip), unlinked papers in rows underneath.
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const pos = new Map<string, { x: number; y: number }>();
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const r = find(p);
    parent.set(id, r);
    return r;
  };
  for (const e of edges) parent.set(find(e.source), find(e.target));
  const clusters = new Map<string, GraphNodeData[]>();
  for (const n of shown) {
    if (!linked.has(n.id)) continue;
    const r = find(n.id);
    clusters.set(r, [...(clusters.get(r) ?? []), n]);
  }
  const boxes = [...clusters.values()].map((members) => {
    const ids = new Set(members.map((m) => m.id));
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 80, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of members) g.setNode(n.id, { width: NODE_W, height: estimateHeight(n, kinds.get(n.id)!) });
    for (const e of edges) if (ids.has(e.source)) g.setEdge(e.source, e.target);
    dagre.layout(g);
    const local = new Map<string, { x: number; y: number }>();
    for (const id of g.nodes()) {
      const d = g.node(id);
      local.set(id, { x: d.x - d.width / 2, y: d.y - d.height / 2 });
    }
    return { local, w: g.graph().width ?? NODE_W, h: g.graph().height ?? 100 };
  });
  const CLUSTER_GAP = 90;
  const maxRow = Math.max(NODE_W * 6, ...boxes.map((b) => b.w));
  let bottom = 0;
  let right = 0;
  let cx = 20;
  let cy = 20;
  let rowH = 0;
  for (const b of boxes) {
    if (cx > 20 && cx + b.w > maxRow) {
      cx = 20;
      cy += rowH + CLUSTER_GAP;
      rowH = 0;
    }
    for (const [id, p] of b.local) pos.set(id, { x: cx + p.x, y: cy + p.y });
    cx += b.w + CLUSTER_GAP;
    rowH = Math.max(rowH, b.h);
    right = Math.max(right, cx - CLUSTER_GAP);
    bottom = cy + rowH;
  }
  right = Math.max(right, NODE_W * 4);
  const loners = shown.filter((n) => !linked.has(n.id));
  const perRow = Math.max(1, Math.min(loners.length, Math.floor((right + 48) / (NODE_W + 48))));
  let y = linked.size ? bottom + 120 : 20;
  for (let i = 0; i < loners.length; i += perRow) {
    const row = loners.slice(i, i + perRow);
    const rowW = row.length * NODE_W + (row.length - 1) * 48;
    let x = Math.max(20, (right - rowW) / 2);
    let h = 0;
    for (const n of row) {
      pos.set(n.id, { x, y });
      x += NODE_W + 48;
      h = Math.max(h, estimateHeight(n, kinds.get(n.id)!));
    }
    y += h + 48;
  }

  const nodes = shown.map((n) => ({ ...n, ...(pos.get(n.id) ?? { x: n.x, y: n.y }) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Supports / contradicts are mutual between papers, so draw them from the upper paper down:
  // lines then always leave a node's bottom and enter the next node's top.
  for (const e of edges) {
    if (e.type === "gap") continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (s && t && s.y > t.y) [e.source, e.target] = [e.target, e.source];
  }

  // What each claim links to, from that claim's side.
  const claimLinks = new Map<string, ClaimRelation[]>();
  const addLink = (claimId: string, rel: ClaimRelation) =>
    claimLinks.set(claimId, [...(claimLinks.get(claimId) ?? []), rel]);
  for (const { e, a, b, from, to, line, toGap } of rawLinks) {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb) continue;
    if (toGap) {
      addLink(from.id, { type: "gap", other: pb, line });
    } else {
      addLink(from.id, { type: e.type, other: pb, otherClaim: to, line });
      addLink(to.id, { type: e.type, other: pa, otherClaim: from, line });
    }
  }

  const count = (t: GraphEdgeData["type"]) => edges.filter((e) => e.type === t).length;
  return {
    nodes,
    edges,
    byId,
    kind: (id) => kinds.get(id) ?? "paper",
    claims,
    claimsOf,
    claimLinks,
    linksOf,
    resolveId: (id) => {
      const h = id ? holder.get(id) : undefined;
      return h && byId.has(h) ? h : null;
    },
    isLinked: (id) => linked.has(id),
    counts: {
      claim: claims.length,
      paper: nodes.filter((n) => kinds.get(n.id) === "paper").length,
      supports: count("supports"),
      contradicts: count("contradicts"),
      gap: nodes.filter((n) => kinds.get(n.id) === "gap").length,
      unlinked: loners.filter((n) => kinds.get(n.id) !== "gap").length,
    },
  };
}

/* ---------------------------------------------------------------- relations in words */

export interface Connection {
  edge: GraphEdgeData;
  other: GraphNodeData;
  verb: string;
  color: string;
}

// Paper-to-paper support and contradiction are mutual, so they read the same both ways.
const VERBS: Record<GraphEdgeData["type"], [out: string, inc: string, color: string]> = {
  supports: ["Agrees with", "Agrees with", "var(--status-support)"],
  contradicts: ["Contradicts", "Contradicts", "var(--status-contradict)"],
  gap: ["Leaves open", "Raised by", "var(--status-gap)"],
  prerequisite: ["Leads to", "Builds on", "var(--accent)"],
};

/** Every line touching `id`, phrased from that node's point of view. */
export function connectionsOf(model: HypothesisModel, id: string): Connection[] {
  const out: Connection[] = [];
  for (const e of model.edges) {
    const outgoing = e.source === id;
    if (!outgoing && e.target !== id) continue;
    const other = model.byId.get(outgoing ? e.target : e.source);
    if (!other) continue;
    const [o, i, color] = VERBS[e.type];
    out.push({ edge: e, other, verb: outgoing ? o : i, color });
  }
  return out;
}
