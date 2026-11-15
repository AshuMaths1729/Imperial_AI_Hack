export type WorkspaceMode = "lecture" | "paper2sim" | "hypothesis";

/* ---- PaperSim explanatory docs (mirror of backend app/modules/sim/models.py SimDocs) ---- */
export interface SourceLoc {
  section?: string;
  page?: number | null;
  quote?: string;
}
export interface ParamDoc {
  key: string;
  symbol_latex?: string;
  meaning: string;
  effect: string;
  typical?: string;
  source?: SourceLoc | null;
}
export type ConceptKind =
  | "paper"
  | "model"
  | "concept"
  | "variable"
  | "parameter"
  | "assumption"
  | "result"
  | "cited_work";
export interface ConceptDoc {
  id: string;
  label: string;
  kind: ConceptKind;
  summary: string;
  detail?: string;
  latex?: string;
  param_key?: string | null;
  source?: SourceLoc | null;
}
export interface ConceptLink {
  source: string;
  target: string;
  relation: string;
  explanation?: string;
  kind?: "prerequisite" | "supports" | "contradicts" | "gap";
}
export interface EquationVar {
  symbol_latex: string;
  meaning: string;
}
export interface EquationDoc {
  id: string;
  title: string;
  latex: string;
  explanation: string;
  variables?: EquationVar[];
  source?: SourceLoc | null;
}
export interface DerivationStep {
  title: string;
  latex?: string;
  explanation: string;
}
export interface SimPreset {
  name: string;
  description: string;
  /** After backend sanitising: a value for every PARAMS key, each within range. */
  params: Record<string, number>;
  /** What the learner should see in the plot when this scenario is applied. */
  expected?: string;
  source?: SourceLoc | null;
}
export interface SeriesDoc {
  name: string;
  meaning: string;
  how_to_read?: string;
}
export interface SimDocs {
  overview: string;
  key_findings?: string[];
  params?: ParamDoc[];
  concepts?: ConceptDoc[];
  links?: ConceptLink[];
  equations?: EquationDoc[];
  derivation?: DerivationStep[];
  presets?: SimPreset[];
  series?: SeriesDoc[];
  x_meaning?: string;
  y_meaning?: string;
  limitations?: string[];
  glossary?: EquationVar[];
}

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
  doc_id?: string;
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
  /** Name of the simulated model (may differ from the paper, e.g. a model a survey cites). */
  sim_title?: string;
  assumptions?: string[];
  /** Rich explanatory material from the backend (absent on older/offline specs: always fall back). */
  docs?: SimDocs;
  /** Backend sim id, used to re-run the simulation with new params. */
  sim_id?: string;
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
