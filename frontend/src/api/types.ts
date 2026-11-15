/**
 * Public API types. Re-exports aliases of the generated OpenAPI types (`types.gen.ts`, regenerate
 * with `npm run gen:types`) and hand-writes the few shapes the generated file does not have yet.
 * Hand-written shapes are marked `TODO(gen)` and are provisional until the backend lanes land.
 */
import type { components } from "./types.gen";

type S = components["schemas"];

// ---- generated aliases ------------------------------------------------------------------
export type Graph = S["Graph"];
export type GraphNode = S["Node"];
export type GraphEdge = S["Edge"];
export type GraphKind = Graph["kind"];
export type EdgeType = GraphEdge["type"];
export type SourceRef = S["SourceRef"];
export type Evidence = S["Evidence"];

export type ParamSpec = S["ParamSpec"];
export type SimOutput = S["SimOutput"];
export type SimSeries = S["Series"];
export type SimPayload = S["SimPayload"];

export type AskSpatialRequest = S["AskSpatialRequest"];
export type AskSpatialResponse = S["AskSpatialResponse"];
export type ActiveContext = S["ActiveContext"];
export type HitMetadata = S["HitMetadata"];
export type Segment = S["Segment"];
export type UiAnnotation = Segment["ui_annotations"][number];
export type FollowUp = S["FollowUp"];

export type ErrorBody = S["ErrorBody"];
export type ErrorEnvelope = S["ErrorEnvelope"];
export type HealthResponse = S["HealthResponse"];
export type JobCreated = S["JobCreated"];
export type JobEvent = S["JobEvent"];

// ---- hand-written (not in the generated file yet) ---------------------------------------
// TODO(gen): replace with generated type
export interface IngestLectureResponse {
  graph_id: string;
  doc_id: string;
  graph: Graph;
}

// TODO(gen): replace with generated type
export interface DocInfo {
  doc_id: string;
  filename?: string | null;
  page_count: number;
}

export type PageImageSize = "thumb" | "full";

// TODO(gen): replace with generated type
export interface QuizQuestionPublic {
  id: string;
  question: string;
  options: string[];
  /** May be withheld by the backend until answered. */
  correct_index?: number | null;
  explanation?: string | null;
}

// TODO(gen): replace with generated type
export interface QuizResponse {
  graph_id?: string;
  node_id: string;
  questions: QuizQuestionPublic[];
}

// TODO(gen): replace with generated type
export interface QuizAnswerResult {
  correct: boolean;
  correct_index?: number | null;
  explanation?: string | null;
  /** Updated mastery for the node, 0-100. */
  mastery?: number;
  node_id?: string;
}

// TODO(gen): replace with generated type
export interface NextQuiz {
  node_id: string | null;
  questions: QuizQuestionPublic[];
}

// TODO(gen): replace with generated type
export interface Mastery {
  graph_id?: string;
  /** node id -> mastery 0-100 */
  mastery: Record<string, number>;
}

// TODO(gen): replace with generated type
export interface TopicRequest {
  query: string;
  max_papers?: number;
}

// TODO(gen): replace with generated type
export interface PaperSource {
  paper_id: string;
  title?: string | null;
  authors?: string[];
  abstract?: string | null;
  arxiv_id?: string | null;
  url?: string | null;
  text?: string | null;
  [extra: string]: unknown;
}

/** Exactly one of `arxiv_id`, `url` or `file`. */
// TODO(gen): replace with generated type
export type IngestPaperInput = { arxiv_id: string } | { url: string } | { file: File | Blob };

// TODO(gen): replace with generated type
export interface SimGenerateRequest {
  paper_text?: string;
  arxiv_id?: string;
  hint?: string;
}

/** Backend `SimSpec` extends `SimPayload`, so params/default_output are top-level (not nested). */
export type SimSpec = SimPayload & {
  sim_id: string;
  title?: string;
  explanation?: string;
  assumptions?: string[];
  docs?: import("../types/scholartwin").SimDocs | null;
  [extra: string]: unknown;
};

// TODO(gen): replace with generated type
export interface SimRunResult {
  output: SimOutput;
  runner: string;
  ms: number;
}

// TODO(gen): replace with generated type
export interface TtsResult {
  media_id: string;
  /** Absolute, or relative to the API base (use `resolveMediaUrl`). */
  url: string;
}

// TODO(gen): replace with generated type
export interface SttResult {
  transcript: string;
}

// TODO(gen): replace with generated type
export interface AvatarSession {
  provider?: string;
  session_id?: string | null;
  token?: string | null;
  [extra: string]: unknown;
}

// TODO(gen): replace with generated type
export interface PresetInfo {
  name: string;
  title?: string | null;
  description?: string | null;
}

// TODO(gen): replace with generated type
export interface PresetState {
  name: string;
  graph_id?: string | null;
  doc_id?: string | null;
  sim_id?: string | null;
  paper_id?: string | null;
  [extra: string]: unknown;
}
