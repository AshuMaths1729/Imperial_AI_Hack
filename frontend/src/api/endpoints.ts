/** One small typed function per backend endpoint (all under `/api`). */
import { apiUrl, request } from "./client";
import { USE_FIXTURES, fixtureAskSpatial, fixtureGetGraph, fixtureGetSim } from "./fixtures";
import type {
  AskSpatialRequest,
  AskSpatialResponse,
  AvatarSession,
  DocInfo,
  Graph,
  HealthResponse,
  IngestLectureResponse,
  IngestPaperInput,
  Mastery,
  NextQuiz,
  PageImageSize,
  PaperSource,
  PresetInfo,
  PresetState,
  QuizAnswerResult,
  QuizResponse,
  Segment,
  SimGenerateRequest,
  SimRunResult,
  SimSpec,
  SttResult,
  TtsResult,
} from "./types";

type Opts = { signal?: AbortSignal };
const enc = encodeURIComponent;

export const health = ({ signal }: Opts = {}) =>
  request<HealthResponse>("/health", { signal });

// ---- graphs / lecture ingest / docs -----------------------------------------------------
export function getGraph(graphId: string, { signal }: Opts = {}): Promise<Graph> {
  if (USE_FIXTURES) return fixtureGetGraph(graphId);
  return request<Graph>(`/graphs/${enc(graphId)}`, { signal });
}

export function ingestLecture(file: File | Blob, { signal }: Opts = {}) {
  const form = new FormData();
  form.append("file", file);
  return request<IngestLectureResponse>("/ingest/lecture", { method: "POST", form, signal });
}

export const getDoc = (docId: string, { signal }: Opts = {}) =>
  request<DocInfo>(`/docs/${enc(docId)}`, { signal });

/** Plain URL for `<img src>`; `page` is 1-based. */
export const getPageImageUrl = (docId: string, page: number, size: PageImageSize = "thumb") =>
  apiUrl(`/docs/${enc(docId)}/pages/${page}.png`, { size });

// ---- quiz / mastery ---------------------------------------------------------------------
export const getQuiz = (graphId: string, nodeId: string, { signal }: Opts = {}) =>
  request<QuizResponse>(`/quiz/${enc(graphId)}/${enc(nodeId)}`, { signal });

export const answerQuiz = (
  graphId: string,
  nodeId: string,
  body: { question_id: string; choice: number },
  { signal }: Opts = {},
) =>
  request<QuizAnswerResult>(`/quiz/${enc(graphId)}/${enc(nodeId)}/answer`, {
    method: "POST",
    json: body,
    signal,
  });

export const nextQuiz = (graphId: string, { signal }: Opts = {}) =>
  request<NextQuiz>(`/quiz/${enc(graphId)}/next`, { signal });

export const getMastery = (graphId: string, { signal }: Opts = {}) =>
  request<Mastery>(`/mastery/${enc(graphId)}`, { signal });

// ---- topics / papers --------------------------------------------------------------------
export const createTopicGraph = async (
  query: string,
  maxPapers = 30,
  { signal }: Opts = {},
): Promise<Graph> => {
  const res = await request<Graph | { graph: Graph }>("/topics", {
    method: "POST",
    json: { query, max_papers: maxPapers },
    signal,
  });
  return "graph" in res ? res.graph : res;
};

export const getPaper = (paperId: string, { signal }: Opts = {}) =>
  request<PaperSource>(`/papers/${enc(paperId)}`, { signal });

export function ingestPaper(input: IngestPaperInput, { signal }: Opts = {}) {
  const form = new FormData();
  if ("arxiv_id" in input) form.append("arxiv_id", input.arxiv_id);
  else if ("url" in input) form.append("url", input.url);
  else form.append("file", input.file);
  return request<PaperSource>("/ingest/paper", { method: "POST", form, signal });
}

// ---- simulations ------------------------------------------------------------------------
export const generateSim = (req: SimGenerateRequest, { signal }: Opts = {}) =>
  request<SimSpec>("/sim/generate", { method: "POST", json: req, signal });

export function getSim(simId: string, { signal }: Opts = {}): Promise<SimSpec> {
  if (USE_FIXTURES) return fixtureGetSim(simId);
  return request<SimSpec>(`/sim/${enc(simId)}`, { signal });
}

export const runSim = (simId: string, params: Record<string, number>, { signal }: Opts = {}) =>
  request<SimRunResult>("/sim/run", {
    method: "POST",
    json: { sim_id: simId, params },
    signal,
  });

// ---- Circle-to-Ask ----------------------------------------------------------------------
export function askSpatial(req: AskSpatialRequest, { signal }: Opts = {}): Promise<AskSpatialResponse> {
  if (USE_FIXTURES) return fixtureAskSpatial(req);
  return request<AskSpatialResponse>("/ask-spatial/v2", { method: "POST", json: req, signal });
}

// ---- voice / avatar ---------------------------------------------------------------------
export const tts = (text: string, { signal }: Opts = {}) =>
  request<TtsResult>("/tts", { method: "POST", json: { text }, signal });

/** Pre-synthesise every segment in parallel (same order as `segments`). */
export const ttsSegments = (segments: Pick<Segment, "text">[], opts: Opts = {}) =>
  Promise.all(segments.map((s) => tts(s.text, opts)));

export function stt(audio: Blob, { signal }: Opts = {}) {
  const form = new FormData();
  form.append("file", audio, "speech.webm");
  return request<SttResult>("/stt", { method: "POST", form, signal });
}

export const avatarSession = ({ signal }: Opts = {}) =>
  request<AvatarSession>("/avatar/session", { method: "POST", signal });

// ---- presets ----------------------------------------------------------------------------
export const listPresets = ({ signal }: Opts = {}) =>
  request<PresetInfo[]>("/presets", { signal });

export const loadPreset = (name: string, { signal }: Opts = {}) =>
  request<PresetState>(`/presets/${enc(name)}/load`, { method: "POST", signal });

export const currentPreset = ({ signal }: Opts = {}) =>
  request<PresetState | null>("/presets/current", { signal });
