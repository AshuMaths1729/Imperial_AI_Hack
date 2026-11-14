export type WorkspaceMode = "lecture" | "paper2sim" | "hypothesis";

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface GraphNodeData {
  id: string;
  label: string;
  category: "core" | "prerequisite" | "claim" | "paper" | "gap";
  summary: string;
  slide_ref?: string;
  authors_year?: string;
  mastery: number;
  x: number;
  y: number;
  quiz: QuizQuestion[];
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  type: "prerequisite" | "supports" | "contradicts" | "gap";
  label?: string;
  condition?: string;
  evidence?: { paper_id: string; quote: string }[];
}

export interface SimulationParam {
  name: string;
  key: string;
  min_val: number;
  max_val: number;
  step: number;
  default_val: number;
  unit: string;
}

export interface SimulationSeries {
  name: string;
  color: string;
  y: number[];
}

export interface SimulationPayload {
  paper_title: string;
  arxiv_id: string;
  equation_latex: string;
  summary: string;
  python_code: string;
  params: SimulationParam[];
  x_label: string;
  y_label: string;
  x: number[];
  series: SimulationSeries[];
}

export interface WorkspaceDataset {
  mode: WorkspaceMode;
  title: string;
  subtitle: string;
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  simulation?: SimulationPayload | null;
}

export interface UIAnnotation {
  type: "pulse_node" | "highlight_edge" | "callout_box";
  target_id?: string;
  x?: number;
  y?: number;
  label: string;
}

export interface SpatialAskResponse {
  spoken_answer: string;
  avatar_state: "explaining" | "emphatic" | "questioning";
  annotations: UIAnnotation[];
  suggested_quiz_node_id?: string;
}
