// Pure helpers for the lobby's progress panel and the lesson recap: how each knowledge point stands, and when the
// last lesson was. Built only from data the lesson endpoints already return (track, lessons, lesson state, deck).
import type { KP, Lesson } from "./api";

/** Where a knowledge point stands for the student. */
export type KpMark = "understood" | "revisit" | "next" | "later";

export const KP_MARKS: Record<KpMark, { label: string; cls: string }> = {
  understood: { label: "Understood", cls: "bg-[var(--status-support-soft)] text-[var(--status-support)]" },
  revisit: { label: "Revisit", cls: "bg-[var(--status-warning-soft)] text-[var(--status-warning)]" },
  next: { label: "Next up", cls: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  later: { label: "Not started", cls: "bg-[var(--bg-surface-muted)] text-[var(--text-muted)]" },
};

/**
 * Understood stays understood. A point the tutor introduced but the student hasn't got yet, or one they struggled with
 * in `struggled` (kp ids from the last lesson), is to revisit. The first not-started point whose prerequisites are all
 * understood is next up (else the first not-started one); the rest come later.
 */
export function kpMarks(kps: Pick<KP, "kp_id" | "status" | "prereq_ids">[], struggled: Iterable<string> = []): Map<string, KpMark> {
  const hard = new Set(struggled);
  const done = new Set(kps.filter((k) => k.status === "understood").map((k) => k.kp_id));
  const fresh = kps.filter((k) => k.status === "not_started" && !hard.has(k.kp_id));
  const next = fresh.find((k) => k.prereq_ids.every((p) => done.has(p) || !kps.some((x) => x.kp_id === p))) ?? fresh[0];
  return new Map(
    kps.map((k): [string, KpMark] => [
      k.kp_id,
      k.status === "understood" ? "understood" : k.status === "introduced" || hard.has(k.kp_id) ? "revisit" : k === next ? "next" : "later",
    ])
  );
}

/** The most recently started lesson of a track (the API doesn't promise an order). */
export function lastLesson(lessons: Lesson[]): Lesson | undefined {
  return lessons.reduce<Lesson | undefined>((a, l) => (!a || Date.parse(l.started_at) > Date.parse(a.started_at) ? l : a), undefined);
}

/** "just now", "5 min ago", "2h ago", "yesterday", "3 days ago", else the date. */
export function timeAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
