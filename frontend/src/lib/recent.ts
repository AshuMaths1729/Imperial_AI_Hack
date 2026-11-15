import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { LibraryTopic } from "../components/LibraryView";
import { listTracks, type Track } from "../tutor/shell/api";
import type { WorkspaceDataset, WorkspaceMode } from "../types/scholartwin";

/**
 * "Pick up where you left off": one recent list across the three modules.
 *
 * - Paper Simulator papers come from the library (`scholartwin.library.v1`, owned by app/page.tsx).
 * - Evidence Map topics are read, never written, from `scholartwin.hypothesis.history.v1`
 *   (owned by HypothesisChatView; the shape is its TopicRun). Parsed defensively.
 * - Live Lessons tracks come from the backend (`listTracks`); when it is down they are left out.
 */

export const HYPOTHESIS_HISTORY_KEY = "scholartwin.hypothesis.history.v1";
export const LESSON_ROUTE = "/lecture/lesson";

export type RecentItem = {
  /** Unique across modules. */
  key: string;
  module: WorkspaceMode;
  /** Library topic id, evidence topic id or track id. */
  id: string;
  title: string;
  /** What is inside, without the module name ("4 sliders", "12 papers"). May be empty. */
  detail: string;
  /** A short status pill ("Resume", "1 conflict"). */
  chip?: string;
  /** ISO time of the last change, when there is one. */
  at: string | null;
};

/** The lesson page opens this track directly. */
export function lessonHref(trackId: string): string {
  return `${LESSON_ROUTE}?track=${encodeURIComponent(trackId)}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------- Paper Simulator ---------- */

/** arXiv ids: new style 1706.03762(v5) (same pattern page.tsx sends to the backend), and old
 *  style hep-th/9901001(v2), which only counts on its own or in an arXiv link. */
const ARXIV_NEW = /(\d{4}\.\d{4,5})(?:v\d+)?/i;
const ARXIV_OLD = /([a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/i;
const ARXIV_OLD_ALONE = /^[a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i;

export function findArxivId(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.trim();
  const m = s.match(ARXIV_NEW) ?? (ARXIV_OLD_ALONE.test(s) || /arxiv/i.test(s) ? s.match(ARXIV_OLD) : null);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Which paper a library entry is, so the same paper is listed once: its arXiv id when there is
 * one (from the simulation or the source), else where it came from (file name or URL).
 * Built-in examples are only ever themselves.
 */
export function paperKey(topic: Pick<LibraryTopic, "id" | "sourceType" | "sourceLabel" | "dataset">): string {
  if (topic.sourceType === "preset") return `preset:${topic.id}`;
  const arxiv = findArxivId(topic.dataset?.simulation?.arxiv_id) ?? findArxivId(topic.sourceLabel);
  if (arxiv) return `arxiv:${arxiv}`;
  return `${topic.sourceType}:${(topic.sourceLabel || topic.id).trim().toLowerCase()}`;
}

/** Keeps the first (newest) entry of each paper. Entries are stored newest first. */
export function dedupeTopics<T extends Pick<LibraryTopic, "id" | "sourceType" | "sourceLabel" | "dataset">>(
  topics: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of topics) {
    const k = paperKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Where a saved paper came from, in a few words. */
export function paperSource(topic: Pick<LibraryTopic, "sourceType" | "sourceLabel" | "dataset">): string {
  if (topic.sourceType === "preset") return "Example";
  const arxiv = findArxivId(topic.sourceLabel) ?? findArxivId(topic.dataset?.simulation?.arxiv_id);
  if (arxiv) return `arXiv ${arxiv}`;
  return topic.sourceLabel;
}

export function sliderCount(dataset: WorkspaceDataset | undefined): number {
  const params = dataset?.simulation?.params;
  return Array.isArray(params) ? params.length : 0;
}

/** Library papers the user opened (built-in examples are not "where you left off"). */
export function paperItems(topics: LibraryTopic[]): RecentItem[] {
  return dedupeTopics(topics.filter((t) => t && t.mode === "paper2sim" && t.sourceType !== "preset")).map((t) => {
    const sim = t.dataset?.simulation;
    const model = sim?.sim_title && sim.sim_title !== t.title ? sim.sim_title : "";
    const n = sliderCount(t.dataset);
    return {
      key: `paper2sim:${t.id}`,
      module: "paper2sim",
      id: t.id,
      title: t.title || "Untitled paper",
      detail: model || paperSource(t),
      chip: n ? plural(n, "slider") : undefined,
      at: t.updatedAt || null,
    };
  });
}

/* ---------- Evidence Map ---------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Saved Evidence Map topics from the raw storage value. Anything malformed is skipped. */
export function evidenceItems(raw: string | null): RecentItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RecentItem[] = [];
  for (const run of parsed) {
    // HypothesisChatView drops entries without a dataset, so they can't be opened either.
    if (!isRecord(run) || typeof run.id !== "string" || !run.id || !isRecord(run.dataset)) continue;
    const nodes = Array.isArray(run.dataset.nodes) ? run.dataset.nodes : [];
    const edges = Array.isArray(run.dataset.edges) ? run.dataset.edges : [];
    const papers = nodes.filter((n) => isRecord(n) && n.category === "paper").length;
    const conflicts = edges.filter((e) => isRecord(e) && e.type === "contradicts").length;
    const title = typeof run.title === "string" && run.title.trim() ? run.title.trim() : "Untitled question";
    out.push({
      key: `hypothesis:${run.id}`,
      module: "hypothesis",
      id: run.id,
      title,
      detail: papers ? plural(papers, "paper") : nodes.length ? plural(nodes.length, "idea") : "",
      chip: conflicts ? plural(conflicts, "conflict") : undefined,
      at: typeof run.updatedAt === "string" ? run.updatedAt : null,
    });
  }
  return out;
}

/* ---------- Live Lessons ---------- */

export function lessonItems(tracks: Track[]): RecentItem[] {
  const out: RecentItem[] = [];
  for (const t of tracks) {
    if (!t || typeof t.track_id !== "string" || !t.track_id) continue;
    const kps = Array.isArray(t.knowledge_points) ? t.knowledge_points : [];
    const understood = kps.filter((k) => k?.status === "understood").length;
    const started = kps.some((k) => k?.status && k.status !== "not_started");
    const materials = Array.isArray(t.materials) ? t.materials.length : 0;
    out.push({
      key: `lecture:${t.track_id}`,
      module: "lecture",
      id: t.track_id,
      title: t.title || "Untitled lesson",
      detail: kps.length
        ? `${understood} of ${plural(kps.length, "idea")} understood`
        : materials
          ? plural(materials, "source")
          : "",
      chip: started ? "Resume" : "Start",
      at: typeof t.created_at === "string" ? t.created_at : null,
    });
  }
  return out;
}

/* ---------- Merge and time ---------- */

const timeOf = (iso: string | null) => {
  if (!iso) return NaN;
  return new Date(iso).getTime();
};

/** All items, newest first; items without a time keep their order after the dated ones. */
export function mergeRecent(...lists: RecentItem[][]): RecentItem[] {
  return lists
    .flat()
    .map((item, i) => ({ item, i, t: timeOf(item.at) }))
    .sort((a, b) => {
      const aOk = !Number.isNaN(a.t);
      const bOk = !Number.isNaN(b.t);
      if (aOk && bOk && a.t !== b.t) return b.t - a.t;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ item }) => item);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "Just now", "5 min ago", "3h ago", "Yesterday", "4 days ago", then "Nov 15" (or "Nov 15, 2025"). */
export function relativeTime(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  // Rounded to the nearest unit ("now" is only known to the minute, see useNow).
  if (diff < 45_000) return "Just now";
  const m = Math.max(1, Math.round(diff / MIN));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(diff / HOUR);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(diff / DAY);
  if (d <= 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  const sameYear = new Date(t).getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(t);
}

/** The full date for a tooltip. */
export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(t);
}

/* ---------- Hooks ---------- */

/** The current time, to the minute; re-renders once a minute so "5 min ago" stays true. */
function subscribeMinute(cb: () => void) {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
}
const minuteNow = () => Math.floor(Date.now() / MIN) * MIN;
const serverNow = () => 0;

export function useNow(): number {
  return useSyncExternalStore(subscribeMinute, minuteNow, serverNow);
}

function subscribeHistory(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === HYPOTHESIS_HISTORY_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
function readHistory(): string | null {
  try {
    return localStorage.getItem(HYPOTHESIS_HISTORY_KEY);
  } catch {
    return null;
  }
}
const noHistory = () => null;

/** Saved Evidence Map topics (read-only). */
export function useEvidenceTopics(): RecentItem[] {
  const raw = useSyncExternalStore(subscribeHistory, readHistory, noHistory);
  return useMemo(() => evidenceItems(raw), [raw]);
}

/** Live Lessons tracks: null while loading, [] when the backend is unreachable. */
export function useLessonTracks(): Track[] | null {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    listTracks()
      .then((list) => {
        if (!cancelled) setTracks(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return tracks;
}
