"use client";

import { useEffect, useState } from "react";
import { getLessonState, getTrack, type Track } from "./api";
import { useDeck } from "./deckStore";
import { KP_MARKS, kpMarks, lastLesson, timeAgo } from "./progress";

const eyebrow = "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]";

/** What the lobby knows about a track's past lessons: where the last one stopped and what it found hard. */
type History = { lessons: number; ago?: string; stoppedAt?: number; struggled: string[] };

/**
 * The selected topic's progress, for the lobby: where the last lesson stopped in the slides, when it was, and how each
 * knowledge point stands (Understood / Revisit / Next up). Key it by track id so each topic starts fresh. The knowledge
 * points come from `track` (kept current by the lobby as material is added); lessons, checkpoint and deck are fetched.
 */
export function TrackProgress({ track }: { track: Track }) {
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  const { view } = useDeck(track.track_id); // the lobby's shared slide status (one request, kept current)

  useEffect(() => {
    let alive = true;
    getTrack(track.track_id)
      .then(async (detail) => {
        const last = lastLesson(detail.lessons);
        const state = last ? await getLessonState(last.lesson_id).catch(() => null) : null;
        if (!alive) return;
        setHistory({
          lessons: detail.lessons.length,
          ago: last ? timeAgo(last.ended_at ?? last.started_at, Date.now()) : undefined,
          stoppedAt: state?.slide,
          struggled: last?.struggles.map((s) => s.kp_id) ?? [],
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [track.track_id]);

  const kps = track.knowledge_points;
  const marks = kpMarks(kps, history?.struggled);
  const understood = kps.filter((k) => marks.get(k.kp_id) === "understood").length;
  const slides = view?.deck?.slides.length || undefined;
  const slide = history?.stoppedAt && slides ? Math.min(Math.max(1, history.stoppedAt), slides) : undefined;
  const pct = slide && slides ? (slide / slides) * 100 : 0;
  const where = !history
    ? failed
      ? "Couldn't load past lessons"
      : "Loading past lessons…"
    : view?.status === "generating"
      ? "Preparing slides…"
      : slide
        ? `Slide ${slide} of ${slides}`
        : slides
          ? `${slides} slides ready`
          : "No slides yet";

  return (
    <section aria-labelledby="progress-heading" className="apple-sheet st-fade-up grid grid-cols-1 gap-4 rounded-[26px] p-4 sm:p-5" style={{ animationDelay: "80ms" }}>
      <div className="grid grid-cols-1 gap-1">
        <p className={eyebrow}>Your progress</p>
        <h3 id="progress-heading" className="apple-heading text-xl font-normal tracking-[-0.02em] text-[var(--text-primary)]">
          {track.title}
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-2.5 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13.5px]">
          <span className="font-medium text-[var(--text-primary)]">{where}</span>
          <span className="text-[var(--text-muted)]">
            {history ? (history.ago ? `Last lesson ${history.ago}` : "No lessons yet") : ""}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Where the last lesson stopped"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-valuetext={where}
          className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]"
        >
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--accent), var(--status-support))" }}
          />
        </div>
      </div>

      {kps.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No knowledge points yet. Add your own slides or a paper to build this topic.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <ul aria-label="Knowledge points" className="grid grid-cols-1 gap-1">
            {kps.map((k) => {
              const m = KP_MARKS[marks.get(k.kp_id) ?? "later"];
              return (
                <li key={k.kp_id} className="flex items-start justify-between gap-3 py-1 text-[13.5px] leading-snug">
                  <span className="min-w-0 text-[var(--text-primary)]">{k.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[11px] font-medium leading-none ${m.cls}`}>{m.label}</span>
                </li>
              );
            })}
          </ul>
          <p className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {understood} of {kps.length} understood
            {history && history.lessons > 0 ? ` · ${history.lessons} lesson${history.lessons === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      )}
    </section>
  );
}

/** The progress panel's place before a topic is chosen. */
export function NoTrackProgress() {
  return (
    <section aria-labelledby="progress-heading" className="apple-sheet st-fade-up grid grid-cols-1 gap-2 rounded-[26px] p-4 sm:p-5" style={{ animationDelay: "80ms" }}>
      <p className={eyebrow}>Your progress</p>
      <h3 id="progress-heading" className="apple-heading text-xl font-normal tracking-[-0.02em] text-[var(--text-primary)]">
        Pick a topic
      </h3>
      <p className="text-sm leading-relaxed text-[var(--text-muted)]">
        Choose a topic to see what you&apos;ve understood, what to revisit, and where your last lesson stopped.
      </p>
    </section>
  );
}
