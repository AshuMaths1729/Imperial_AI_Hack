/**
 * Layered top-down layout (dagre). Edge labels are laid out as real boxes in their own half-rank,
 * so a label can never sit on top of a node or another label, and every edge is routed through
 * dagre's waypoints (it never loops over a node).
 */
import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { ConceptKind } from "../../../types/scholartwin";
import type { ConceptGraph } from "./model";

export interface NodeBox {
  x: number; // top-left
  y: number;
  w: number;
  h: number;
}

export interface EdgeRoute {
  /** Inner waypoints (absolute), between the source's bottom handle and the target's top handle. */
  points: { x: number; y: number }[];
  labelX: number;
  labelY: number;
  labelW: number;
  labelLines: number;
}

export interface GraphLayout {
  nodes: Record<string, NodeBox>;
  edges: Record<string, EdgeRoute>;
}

export function nodeSize(kind: ConceptKind, isRoot: boolean): { w: number; h: number } {
  if (isRoot) return { w: 304, h: 118 };
  if (kind === "parameter") return { w: 236, h: 104 };
  return { w: 236, h: 100 };
}

export const LABEL_FONT_PX = 10.5;
export const LABEL_LINE_PX = 13;
export const LABEL_MAX_W = 168;
const LABEL_PAD_X = 10;
const LABEL_PAD_Y = 4;
/** Rough average glyph width for 10.5px semibold UI sans. */
const CHAR_PX = 6.1;

export function measureLabel(text: string): { w: number; h: number; lines: number } {
  const raw = text.length * CHAR_PX;
  const inner = LABEL_MAX_W - LABEL_PAD_X * 2;
  const lines = Math.min(2, Math.max(1, Math.ceil(raw / inner)));
  const w = Math.min(LABEL_MAX_W, Math.ceil(raw) + LABEL_PAD_X * 2 + 2);
  return { w, h: lines * LABEL_LINE_PX + LABEL_PAD_Y * 2 + 2, lines };
}

export function layoutGraph(g: ConceptGraph): GraphLayout {
  const dg = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: false, directed: true });
  dg.setGraph({
    rankdir: "TB",
    nodesep: 44,
    edgesep: 18,
    // Halved internally because edge labels take their own rank: ~32px node->label->node.
    // Kept tight: deep paper graphs otherwise get so tall that "fit" shrinks everything.
    ranksep: 64,
    marginx: 32,
    marginy: 32,
    ranker: "network-simplex",
  });
  dg.setDefaultEdgeLabel(() => ({}));

  for (const n of g.nodes) {
    const { w, h } = nodeSize(n.kind, n.isRoot);
    dg.setNode(n.id, { width: w, height: h });
  }
  const labelDims = new Map<string, { w: number; lines: number }>();
  for (const l of g.links) {
    const m = measureLabel(l.relation);
    labelDims.set(l.id, { w: m.w, lines: m.lines });
    dg.setEdge(l.source, l.target, {
      width: m.w + 12, // breathing room between neighbouring labels
      height: m.h + 6,
      labelpos: "c",
      // Links out of the root are the spine of the explanation: keep them short and straight.
      weight: l.source === g.rootId ? 3 : 1,
      minlen: 1,
    });
  }

  dagre.layout(dg);

  const nodes: Record<string, NodeBox> = {};
  for (const n of g.nodes) {
    const d: NodeLabel | undefined = dg.node(n.id);
    const { w, h } = nodeSize(n.kind, n.isRoot);
    nodes[n.id] = { x: (d?.x ?? 0) - w / 2, y: (d?.y ?? 0) - h / 2, w, h };
  }

  // A wide rank (e.g. a model with a dozen parameters/assumptions) would make the whole map
  // one very long row, so "fit to screen" shrinks everything to ~15%. Wrap such ranks into a
  // compact grid of rows instead, and route edges/labels for the wrapped layout.
  if (wrapWideRanks(g, nodes)) return { nodes, edges: routeWrapped(g, nodes, labelDims) };

  const edges: Record<string, EdgeRoute> = {};
  for (const l of g.links) {
    const e: EdgeLabel | undefined = dg.edge(l.source, l.target);
    const pts = e?.points ?? [];
    const inner = pts.length > 2 ? pts.slice(1, -1) : [];
    const s = nodes[l.source];
    const t = nodes[l.target];
    const fallbackX = s && t ? (s.x + s.w / 2 + t.x + t.w / 2) / 2 : 0;
    const fallbackY = s && t ? (s.y + s.h + t.y) / 2 : 0;
    const dims = labelDims.get(l.id) ?? { w: 80, lines: 1 };
    edges[l.id] = {
      points: inner.map((p) => ({ x: p.x, y: p.y })),
      labelX: typeof e?.x === "number" ? e.x : fallbackX,
      labelY: typeof e?.y === "number" ? e.y : fallbackY,
      labelW: dims.w,
      labelLines: dims.lines,
    };
  }
  return { nodes, edges };
}

/* ------------------------------------------------------------------ wrapped (grid) layout */

const MAX_PER_ROW = 4;
const COL_GAP = 40;
/** Vertical gap between wrapped rows of one rank: room for a 2-line label pill + arrow. */
const ROW_GAP = 72;
/** Vertical gap between ranks. */
const RANK_GAP = 92;
const MARGIN = 32;

/**
 * Re-flow dagre's ranks into rows of at most MAX_PER_ROW nodes (balanced, dagre's left-to-right
 * order kept), centred on the widest row. Mutates `nodes`; returns false when no rank is wide.
 */
function wrapWideRanks(g: ConceptGraph, nodes: Record<string, NodeBox>): boolean {
  const ranks = new Map<number, string[]>();
  for (const n of g.nodes) {
    const b = nodes[n.id];
    const key = Math.round(b.y + b.h / 2);
    const list = ranks.get(key) ?? [];
    list.push(n.id);
    ranks.set(key, list);
  }
  const ordered = [...ranks.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
  if (!ordered.some((ids) => ids.length > MAX_PER_ROW)) return false;

  // Split each rank into balanced rows.
  const rows: string[][][] = ordered.map((ids) => {
    const sorted = [...ids].sort((a, b) => nodes[a].x - nodes[b].x);
    const count = Math.ceil(sorted.length / MAX_PER_ROW);
    const base = Math.floor(sorted.length / count);
    const extra = sorted.length % count;
    const out: string[][] = [];
    let i = 0;
    for (let r = 0; r < count; r++) {
      const size = base + (r < extra ? 1 : 0);
      out.push(sorted.slice(i, i + size));
      i += size;
    }
    return out;
  });

  const rowWidth = (row: string[]) =>
    row.reduce((s, id) => s + nodes[id].w, 0) + COL_GAP * Math.max(0, row.length - 1);
  const maxWidth = Math.max(...rows.flat().map(rowWidth));
  const centerX = MARGIN + maxWidth / 2;

  let y = MARGIN;
  rows.forEach((rankRows, r) => {
    if (r > 0) y += RANK_GAP - ROW_GAP;
    for (const row of rankRows) {
      let x = centerX - rowWidth(row) / 2;
      const h = Math.max(...row.map((id) => nodes[id].h));
      for (const id of row) {
        nodes[id] = { ...nodes[id], x, y: y + (h - nodes[id].h) / 2 };
        x += nodes[id].w + COL_GAP;
      }
      y += h + ROW_GAP;
    }
  });
  return true;
}

/**
 * Edges in the wrapped layout run as smooth curves from the source's bottom to the target's
 * top (no waypoints). Each label sits in the gap just above its target, so labels never cover
 * a node; several links into one node are spread side by side.
 */
function routeWrapped(
  g: ConceptGraph,
  nodes: Record<string, NodeBox>,
  labelDims: Map<string, { w: number; lines: number }>
): Record<string, EdgeRoute> {
  const incoming = new Map<string, string[]>();
  for (const l of g.links) {
    const list = incoming.get(l.target) ?? [];
    list.push(l.id);
    incoming.set(l.target, list);
  }
  const edges: Record<string, EdgeRoute> = {};
  for (const l of g.links) {
    const t = nodes[l.target];
    const dims = labelDims.get(l.id) ?? { w: 80, lines: 1 };
    const siblings = incoming.get(l.target) ?? [l.id];
    const idx = siblings.indexOf(l.id);
    const spread = Math.min(t.w / siblings.length, LABEL_MAX_W + 6);
    const offset = (idx - (siblings.length - 1) / 2) * spread;
    edges[l.id] = {
      points: [],
      labelX: t.x + t.w / 2 + offset,
      labelY: t.y - ROW_GAP / 2 + 2,
      labelW: Math.min(dims.w, siblings.length > 1 ? spread - 6 : dims.w),
      labelLines: dims.lines,
    };
  }
  return edges;
}
