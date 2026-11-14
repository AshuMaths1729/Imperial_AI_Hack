import type { Graph, SimOutput, SimSpec } from "./types";
import type {
  GraphEdgeData,
  GraphNodeData,
  SimulationParam,
  SimulationSeries,
  WorkspaceDataset,
  WorkspaceMode,
} from "../types/scholartwin";

const SERIES_COLORS = ["#38bdf8", "#34d399", "#f472b6", "#fbbf24", "#a78bfa"];

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
      authors_year: n.authors_year ?? (n.source_ref?.doc_id ? n.source_ref.doc_id : undefined),
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

export function simSpecToWorkspaceDataset(
  spec: SimSpec,
  title?: string,
  subtitle?: string
): WorkspaceDataset {
  const params: SimulationParam[] = Object.entries(spec.payload.params).map(([key, p]) => ({
    key,
    name: p.label ?? key,
    min_val: p.min,
    max_val: p.max,
    step: p.step ?? (p.max - p.min) / 20,
    default_val: p.default,
    unit: p.unit ?? "",
  }));

  const { x, series } = simOutputToSeries(spec.payload.default_output);

  return {
    mode: "paper2sim",
    title: title || spec.payload.default_output.title || "Paper Simulation",
    subtitle: subtitle || `${params.length} interactive parameters`,
    nodes: [],
    edges: [],
    simulation: {
      paper_title: title || spec.payload.default_output.title || "Paper Simulation",
      arxiv_id: spec.sim_id,
      equation_latex: "",
      summary: spec.payload.default_output.title || "Interactive parameter simulation",
      python_code: typeof spec.code === "string" ? spec.code : "",
      params,
      x_label: spec.payload.default_output.x_label ?? "x",
      y_label: spec.payload.default_output.y_label ?? "y",
      x,
      series,
    },
  };
}
