// Pure lesson maths for the call header and side panel: timer, progress through the deck's ideas, mastery, transcript.
import type { Deck, SlidesDescription } from "@/tutor/slides/types";
import type { KP, LessonState } from "./api";
import type { Caption } from "./session";

export type DeckPosition = Pick<SlidesDescription, "index" | "step" | "slides">;
export type KeyPoint = { id: string; text: string; state: "done" | "now" | "upcoming" };

/** Elapsed lesson time as mm:ss (minutes keep counting past an hour). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Where the lesson is in the deck's ideas. Follow-up slides the tutor pushed are not ideas of the lesson: they stay on
 * the slide they explain. `now` is the 0-based idea on screen; `covered` counts the ideas before it, plus the open one
 * once its last step has played.
 */
export function progressOf(d: DeckPosition | null): { now: number; covered: number; total: number } {
  if (!d || !d.slides.length || d.index < 1) return { now: -1, covered: 0, total: 0 };
  const total = d.slides.filter((s) => !s.followup).length;
  const now = Math.max(0, d.slides.slice(0, d.index).filter((s) => !s.followup).length - 1);
  const cur = d.slides[d.index - 1];
  const done = !!cur && !cur.followup && d.step >= cur.steps;
  return { now, covered: Math.min(total, now + (done ? 1 : 0)), total };
}

/** The deck's slide ideas in order (the idea if the slide has one, else its title), with done / now / upcoming. */
export function keyPoints(deck: Deck | null, d: DeckPosition | null): KeyPoint[] {
  if (!d) return [];
  const { now } = progressOf(d);
  return d.slides
    .filter((s) => !s.followup)
    .map((s, i): KeyPoint => {
      const slide = deck?.slides.find((x) => x.id === s.id);
      return { id: s.id, text: slide?.idea || slide?.title || s.title, state: i < now ? "done" : i === now ? "now" : "upcoming" };
    });
}

/** % of the track's knowledge points understood; without KPs, % of the lesson's checked concepts the student got. */
export function mastery(kps: Pick<KP, "status">[], concepts: LessonState["concepts"]): number | null {
  if (kps.length) return Math.round((kps.filter((k) => k.status === "understood").length / kps.length) * 100);
  const checked = concepts.filter((c) => c.level);
  if (!checked.length) return null;
  return Math.round((checked.filter((c) => c.level === "got_it").length / checked.length) * 100);
}

export function transcriptText(captions: Caption[], tutorName: string): string {
  return captions
    .filter((c) => c.text.trim())
    .map((c) => `${c.who === "tutor" ? tutorName : "You"}: ${c.text.trim()}\n`)
    .join("");
}

/** Saves the conversation so far as a plain .txt file. */
export function downloadTranscript(captions: Caption[], tutorName: string, title: string) {
  const url = URL.createObjectURL(new Blob([transcriptText(captions, tutorName)], { type: "text/plain;charset=utf-8" }));
  const name = (title || "lesson").replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name}-transcript-${new Date().toISOString().slice(0, 10)}.txt` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
