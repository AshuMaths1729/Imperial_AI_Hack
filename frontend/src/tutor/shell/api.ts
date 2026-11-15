// Typed client for the tutor backend (README §7–§8) and the team's ingest endpoints.
import type { WorkspaceDataset } from "@/types/scholartwin";
import type { DeckView } from "@/tutor/slides/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export type Tutor = { tutor_id: string; name: string; avatar_id: string; voice_id: string; style_prompt: string };
export type KP = {
  kp_id: string;
  title: string;
  summary: string;
  prereq_ids: string[];
  status: "not_started" | "introduced" | "understood";
  evidence: string;
};
export type Material = { kind: "pdf" | "url" | "demo"; ref: string; dataset_title: string };
export type Track = {
  track_id: string;
  user_id: string;
  title: string;
  materials: Material[];
  knowledge_points: KP[];
  created_at: string;
};
export type Lesson = {
  lesson_id: string;
  track_id: string;
  tutor_id: string;
  started_at: string;
  ended_at: string | null;
  summary: string;
  covered_kp_ids: string[];
  struggles: { kp_id: string; what: string; tried_explanations: string[] }[];
  worked: { kp_id: string; explanation_style: string }[];
  board_snapshot_ref: string | null;
};
/** GET /api/lesson/lessons/{id}/state: the agent's latest checkpoint (null until the first one). */
export type LessonState = {
  slide: number;
  step: number;
  idea: string;
  detours: { topic: string; why: string; from_slide: number; from_step: number; from_idea: string }[];
  concepts: { concept: string; level: "not_yet" | "shaky" | "got_it" | null; evidence: string; anchor: string; tries: number }[];
  saved_at?: string | null;
};
export type SessionInfo = { url: string; token: string; room: string; lesson_id: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    // FastAPI validation errors put a list in `detail`; `status` lets callers explain e.g. a 413
    const msg = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const listTutors = () => request<Tutor[]>("/api/lesson/tutors");
export const listTracks = () => request<Track[]>("/api/lesson/tracks");
export const createTrack = (title: string) => post<Track>("/api/lesson/tracks", { title });
export const getTrack = (id: string) =>
  request<{ track: Track; lessons: Lesson[] }>(`/api/lesson/tracks/${encodeURIComponent(id)}`);
export const addMaterial = (trackId: string, m: { kind: Material["kind"]; ref: string; dataset: WorkspaceDataset }) =>
  post<Track>(`/api/lesson/tracks/${encodeURIComponent(trackId)}/materials`, m);
export const getDeck = (trackId: string) => request<DeckView>(`/api/lesson/tracks/${encodeURIComponent(trackId)}/deck`);
/** Starts (re)generating the track's slides in the background; poll getDeck for the status. */
export const prepareDeck = (trackId: string) => post<DeckView>(`/api/lesson/tracks/${encodeURIComponent(trackId)}/deck`, {});
export const getLessonState = (lessonId: string) =>
  request<LessonState | null>(`/api/lesson/lessons/${encodeURIComponent(lessonId)}/state`);
export const startSession = (trackId: string, tutorId: string) =>
  post<SessionInfo>("/api/lesson/session", { track_id: trackId, tutor_id: tutorId });

/** Full-text PDF ingest: the backend extracts the text, builds knowledge points and stores it for the deck. */
export function uploadPdf(trackId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<Track>(`/api/lesson/tracks/${encodeURIComponent(trackId)}/materials/pdf`, { method: "POST", body: form });
}
export const ingestUrl = (url: string, mode = "lecture") => post<WorkspaceDataset>("/api/ingest/url", { url, mode });
