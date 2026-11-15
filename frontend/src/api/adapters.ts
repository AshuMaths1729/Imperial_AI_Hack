import type { Graph, SimOutput, SimSpec } from "./types";
import { formatCitationLabel } from "./citations";
import type {
  GraphEdgeData,
  GraphNodeData,
  SimulationParam,
  SimulationSeries,
  WorkspaceDataset,
  WorkspaceMode,
} from "../types/scholartwin";

// Okabe-Ito color-blind-safe palette (distinguishable across protanopia, deuteranopia, tritanopia)
const SERIES_COLORS = ["#0284c7", "#e69f00", "#009e73", "#cc79a7", "#d55e00"];

function mapNodeCategory(kind: string, mode: WorkspaceMode): GraphNodeData["category"] {
  if (kind === "prerequisite") return "prerequisite";
  if (kind === "claim") return "claim";
  if (kind === "paper") return "paper";
  if (kind === "gap") return "gap";
  if (mode === "hypothesis") return "claim";
  return "core";
}

function mapEdgeType(type: string): GraphEdgeData["type"] {
  if (type === "supports" || type === "contradicts" || type === "gap") return type;
  return "prerequisite";
}

export function graphToWorkspaceDataset(
  input: Graph | { graph: Graph },
  mode: WorkspaceMode,
  title?: string,
  subtitle?: string
): WorkspaceDataset {
  const graph = "graph" in input ? input.graph : input;
  const nodes: GraphNodeData[] = (graph.nodes ?? []).map((n, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    return {
      id: n.id,
      label: n.label,
      category: mapNodeCategory(n.kind, mode),
      summary: n.summary,
      slide_ref: n.source_ref?.page ? `Slide / Page ${n.source_ref.page}` : undefined,
      authors_year: n.authors_year ?? formatCitationLabel(n.source_ref?.doc_id),
      doc_id: n.source_ref?.doc_id ?? undefined,
      mastery: 0,
      x: 80 + col * 280,
      y: 70 + row * 170,
      quiz: [],
    };
  });

  const edges: GraphEdgeData[] = (graph.edges ?? []).map((e, idx) => ({
    id: e.id || `edge-${idx}`,
    source: e.source,
    target: e.target,
    type: mapEdgeType(e.type),
    label: e.condition ?? undefined,
    condition: e.condition ?? undefined,
    evidence: e.evidence?.map((ev) => ({
      paper_id: ev.paper_id,
      quote: ev.quote,
    })),
  }));

  return {
    mode,
    title: title || (mode === "hypothesis" ? "Hypothesis Graph" : "Lecture Knowledge Graph"),
    subtitle: subtitle || `${nodes.length} concepts · ${edges.length} connections`,
    nodes,
    edges,
  };
}

export function simOutputToSeries(output: SimOutput): { x: number[]; series: SimulationSeries[] } {
  const x = output.series[0]?.x ?? [];
  const series: SimulationSeries[] = output.series.map((s, idx) => ({
    name: s.name,
    color: SERIES_COLORS[idx % SERIES_COLORS.length],
    y: s.y,
  }));
  return { x, series };
}

const recoveredIds = new Map<string, string>();

/**
 * The backend id of a simulation, for `POST /sim/run`.
 * Newer payloads carry `sim_id`. Some saved topics only have the arXiv id in `arxiv_id`, so the
 * id is recovered from the code exactly as the backend derives it:
 * `"sim_" + sha256(python_code)[:10]` (backend app/modules/sim/service.py `make_sim_id`).
 */
export async function resolveSimId(sim: {
  sim_id?: string;
  arxiv_id?: string;
  python_code?: string;
}): Promise<string | undefined> {
  if (sim.sim_id) return sim.sim_id;
  if (sim.arxiv_id?.startsWith("sim_")) return sim.arxiv_id;
  const code = sim.python_code;
  if (!code || typeof crypto === "undefined" || !crypto.subtle) return undefined;
  const cached = recoveredIds.get(code);
  if (cached) return cached;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = `sim_${hex.slice(0, 10)}`;
  recoveredIds.set(code, id);
  return id;
}

export function simSpecToWorkspaceDataset(
  spec: SimSpec,
  title?: string,
  subtitle?: string
): WorkspaceDataset {
  const params: SimulationParam[] = Object.entries(spec.params ?? {}).map(([key, p]) => ({
    key,
    name: p.label ?? key,
    min_val: p.min,
    max_val: p.max,
    step: p.step ?? (p.max - p.min) / 20,
    default_val: p.default,
    unit: p.unit ?? "",
  }));

  const out = spec.default_output;
  const { x, series } = simOutputToSeries(out);
  // Show the source paper first; the simulated model's name goes in the subtitle.
  const simTitle = spec.title || out.title || "";
  const displayTitle = spec.paper_title || simTitle || title || "Paper Simulation";
  const simNote =
    simTitle && simTitle !== displayTitle ? `Simulates: ${simTitle}` : "";

  return {
    mode: "paper2sim",
    title: displayTitle,
    subtitle:
      subtitle ||
      [simNote, `${params.length} interactive parameters`].filter(Boolean).join(" · "),
    nodes: [],
    edges: [],
    simulation: {
      paper_title: displayTitle,
      arxiv_id: spec.arxiv_id || spec.sim_id,
      equation_latex: spec.equation_latex ?? "",
      summary: spec.explanation || out.title || "Interactive parameter simulation",
      python_code: spec.python_code ?? (typeof spec.code === "string" ? spec.code : ""),
      sim_title: simTitle || undefined,
      assumptions: Array.isArray(spec.assumptions) ? spec.assumptions : undefined,
      docs: spec.docs ?? undefined,
      sim_id: spec.sim_id,
      params,
      x_label: out.x_label ?? "x",
      y_label: out.y_label ?? "y",
      x,
      series,
    },
  };
}
