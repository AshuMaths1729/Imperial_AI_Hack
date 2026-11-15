"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Circle, FileText, Link2, Send, X } from "lucide-react";
import { SlidesStage, type Deck } from "@/tutor/slides";
import { Segmented } from "@/components/glass/Segmented";
import { getLessonState, getTrack, type Lesson, type LessonState, type Track } from "./api";
import { AddMaterial } from "./AddMaterial";
import type { KeyPoint } from "./lesson";
import { KP_MARKS, kpMarks } from "./progress";

/** `load()` once, then every 4 s while `poll` is on, until `done(data)` says the wait is over; a failed poll keeps
    the last good data and the next one retries. */
function usePoll<T>(load: (() => Promise<T>) | null, key: string, poll: boolean, done?: (d: T) => boolean) {
  const [data, setData] = useState<T>();
  useEffect(() => {
    if (!load) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () =>
      load().then((d) => {
        if (!alive) return;
        setData(d);
        if (done?.(d)) clearInterval(timer);
      }, () => {});
    void run();
    if (poll) timer = setInterval(run, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies `load`
  }, [key, poll]);
  return [data, setData] as const;
}

export type TrackData = { track: Track; lessons: Lesson[] };
/** Track + lessons (the agent updates KPs during the lesson). */
export const useTrackData = (trackId: string, poll: boolean, done?: (d: TrackData) => boolean) =>
  usePoll<TrackData>(() => getTrack(trackId), trackId, poll, done);
/** The agent's lesson-state checkpoint: position, detours, and how each checked concept went. */
export const useLessonState = (lessonId: string | undefined, poll: boolean) =>
  usePoll<LessonState | null>(lessonId ? () => getLessonState(lessonId) : null, lessonId ?? "", poll)[0];

const label = "apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]";
/** Lesson summaries arrive as light markdown; show them as plain text (line breaks kept, bold markers dropped). */
const plainSummary = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").trim();

export function LessonPanel({ track, lessons, lessonId }: { track: Track; lessons: Lesson[]; lessonId?: string }) {
  const kps = track.knowledge_points;
  const current = lessons.find((l) => l.lesson_id === lessonId && l.ended_at);
  const lastTime = lessons.find((l) => l.lesson_id !== lessonId && l.ended_at && l.summary);
  // The same Understood / Revisit / Next up marks as the lobby; what this lesson found hard is to revisit.
  const marks = kpMarks(kps, current?.struggles.map((s) => s.kp_id));
  const done = kps.filter((k) => marks.get(k.kp_id) === "understood").length;
  return (
    <div className="space-y-5">
      {current && (
        <section aria-label="Lesson recap" className="rounded-[18px] border border-[var(--accent-border)] bg-[var(--accent-soft)] p-3.5">
          <h3 className={`mb-1 ${label}`}>This lesson</h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-primary)]">{plainSummary(current.summary) || "No summary yet."}</p>
          {current.struggles.length > 0 && (
            <p className="mt-2 text-xs text-[var(--text-secondary)]">To practise: {current.struggles.map((s) => s.what).join("; ")}</p>
          )}
        </section>
      )}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className={label}>Knowledge points</h3>
          <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
            {done}/{kps.length} understood
          </span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${kps.length ? (done / kps.length) * 100 : 0}%`, background: "linear-gradient(90deg, var(--accent), var(--status-support))" }}
          />
        </div>
        {kps.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No knowledge points yet. Add material to this topic.</p>
        ) : (
          <ul className="space-y-1">
            {kps.map((k) => {
              const m = KP_MARKS[marks.get(k.kp_id) ?? "later"];
              return (
                <li key={k.kp_id} className="flex items-start justify-between gap-3 py-1">
                  <span className="text-sm text-[var(--text-primary)]">{k.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-1 font-mono text-[10.5px] font-medium leading-none ${m.cls}`}>{m.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {lastTime && (
        <section>
          <h3 className={`mb-1 ${label}`}>Last time</h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">{plainSummary(lastTime.summary)}</p>
        </section>
      )}
    </div>
  );
}

function KeyPoints({ points, covered }: { points: KeyPoint[]; covered: number }) {
  if (!points.length) return <p className="text-xs text-[var(--text-muted)]">The key points of this lesson appear here once the slides are ready.</p>;
  return (
    <div className="space-y-3">
      <p className={label}>
        {covered} of {points.length} ideas covered
      </p>
      <ol className="space-y-1">
        {points.map((p, i) => (
          <li
            key={p.id}
            aria-current={p.state === "now" ? "step" : undefined}
            className={`flex gap-3 rounded-xl px-2.5 py-2 text-sm leading-snug transition-colors ${
              p.state === "now" ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-border)]" : ""
            }`}
          >
            <span className="mt-0.5 shrink-0" aria-hidden>
              {p.state === "done" ? (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : p.state === "now" ? (
                <span className="grid h-4 w-4 place-items-center rounded-full border-2 border-[var(--accent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                </span>
              ) : (
                <Circle className="h-4 w-4 text-[var(--border-strong)]" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-mono text-[10.5px] text-[var(--text-muted)]">{String(i + 1).padStart(2, "0")} · </span>
              <span className={p.state === "upcoming" ? "text-[var(--text-muted)]" : p.state === "now" ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
                {p.text}
              </span>
              <span className="sr-only"> ({p.state === "now" ? "now" : p.state})</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const LEVEL: Record<string, { label: string; cls: string }> = {
  got_it: { label: "Got it", cls: "bg-[var(--status-support-soft)] text-[var(--status-support)]" },
  shaky: { label: "Shaky", cls: "bg-[var(--status-warning-soft)] text-[var(--status-warning)]" },
  not_yet: { label: "Not yet", cls: "bg-[var(--status-contradict-soft)] text-[var(--status-contradict)]" },
};

function CheckYourself({ check, ideaNo, concepts, tutorName, onAnswer }: {
  check?: string | null;
  ideaNo: number;
  concepts: LessonState["concepts"];
  tutorName: string;
  onAnswer: (t: string) => void;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !check) return;
    onAnswer(`My answer to "${check}": ${t}`);
    setText("");
    setSent(true);
  };
  const earlier = concepts.filter((c) => c.level);
  return (
    <div className="space-y-5">
      <section className="space-y-2.5">
        <h3 className={label}>Check yourself{ideaNo > 0 && ` · idea ${ideaNo}`}</h3>
        {check ? (
          <>
            <p className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">{check}</p>
            <form onSubmit={submit} className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setSent(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submit(e);
                }}
                rows={2}
                aria-label="Your answer"
                placeholder="Type your answer…"
                className="apple-focus min-h-11 flex-1 resize-none rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Send answer"
                disabled={!text.trim()}
                title="Send answer"
                // Disabled stays legible: a quiet well with muted ink instead of a faded tint.
                className={`apple-press apple-focus grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                  text.trim() ? "apple-tint" : "cursor-not-allowed border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-muted)]"
                }`}
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </form>
            {sent && (
              <p role="status" className="text-xs text-[var(--accent)]">
                Sent to {tutorName}.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">No question on this slide. {tutorName} asks one at the end of each idea.</p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className={label}>Earlier checks</h3>
        {earlier.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">How each check went appears here.</p>
        ) : (
          <ul className="space-y-2">
            {earlier.map((c) => (
              <li key={c.concept} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)] first-letter:uppercase">{c.concept}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${LEVEL[c.level!].cls}`}>{LEVEL[c.level!].label}</span>
                </div>
                {c.evidence && <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{c.evidence}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The lesson's own slides and knowledge points, to look back at without disturbing the live stage. */
function Review({ deck, data, lessonId, onClose }: { deck: Deck | null; data?: TrackData; lessonId?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portalled to body: a dialog under a glass or animated (transformed) pane would be clipped to it.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Course content" className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-canvas)_60%,transparent)] p-4 backdrop-blur-sm">
      <div className="apple-glass-elevated apple-materialize flex max-h-full w-full max-w-6xl flex-col gap-3 overflow-y-auto rounded-[22px] border p-3 lg:flex-row">
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl lg:flex-1">
          <SlidesStage deck={deck} />
        </div>
        <div className="min-w-0 space-y-3 p-1 lg:w-80">
          <div className="flex items-center justify-between">
            <h2 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">Course content</h2>
            <button type="button" onClick={onClose} aria-label="Close course content" title="Close" className="apple-press apple-focus grid h-8 w-8 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {data ? <LessonPanel {...data} lessonId={lessonId} /> : <p className="text-xs text-[var(--text-muted)]">Loading…</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Materials({ trackId, data, onTrack, deck, lessonId }: { trackId: string; data?: TrackData; onTrack: (t: Track) => void; deck: Deck | null; lessonId?: string }) {
  const [review, setReview] = useState(false);
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setReview(true)}
        className="apple-press apple-focus flex w-full items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2.5 text-left hover:border-[var(--accent-border)]"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[var(--text-primary)]">Review course content</span>
          <span className="block text-xs text-[var(--text-muted)]">
            {deck ? `${deck.slides.length} slides` : "Slides"} and knowledge points of this lesson
          </span>
        </span>
      </button>
      <section className="space-y-2">
        <h3 className={label}>Sources</h3>
        <ul className="space-y-1.5">
          {data?.track.materials.map((m, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              {m.kind === "url" ? (
                <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
              )}
              <span className="truncate" title={m.ref}>
                {m.dataset_title || m.ref}
              </span>
            </li>
          ))}
          {data && !data.track.materials.length && <li className="text-xs text-[var(--text-muted)]">No materials yet.</li>}
        </ul>
      </section>
      <AddMaterial trackId={trackId} onAdded={onTrack} />
      <p className="text-[11px] text-[var(--text-muted)]">Slides prepared now open in your next lesson.</p>
      {review && <Review deck={deck} data={data} lessonId={lessonId} onClose={() => setReview(false)} />}
    </div>
  );
}

const TABS = ["Key points", "Check yourself", "Materials"] as const;

/** Where the tutor's explanation pop-up opens: on the slide (stage bottom-right) or docked at the top of this panel. */
type Placement = "slide" | "panel";
const PLACEMENT_KEY = "st.explanations";
function savedPlacement(): Placement {
  try {
    return localStorage.getItem(PLACEMENT_KEY) === "panel" ? "panel" : "slide";
  } catch {
    return "slide";
  }
}

type Props = {
  trackId: string;
  lessonId?: string;
  tutorName: string;
  points: KeyPoint[];
  covered: number;
  /** The open slide's check question and number. */
  check?: string | null;
  ideaNo: number;
  concepts: LessonState["concepts"];
  data?: TrackData;
  onTrack: (t: Track) => void;
  deck: Deck | null;
  onAnswer: (t: string) => void;
  /** Gets the panel's explanation slot element (null while explanations open on the slide); goes to SlidesStage. */
  explanationRef?: (el: HTMLDivElement | null) => void;
};

export function SidePanel({ explanationRef, ...p }: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Key points");
  const [placement, setPlacementState] = useState<Placement>(savedPlacement);
  const setPlacement = (v: Placement) => {
    setPlacementState(v);
    try {
      localStorage.setItem(PLACEMENT_KEY, v);
    } catch {} // private mode: the choice lasts this lesson only
  };
  return (
    <section aria-label="Side panel" className="apple-sheet st-fade-up flex min-h-80 flex-1 flex-col rounded-[26px] lg:min-h-0" style={{ animationDelay: "80ms" }}>
      <div className="mx-3.5 mt-3 flex shrink-0 items-center justify-between gap-2">
        <span id="explanations-label" className={label}>
          Explanations
        </span>
        <div role="radiogroup" aria-labelledby="explanations-label" className="apple-seg flex gap-0.5 rounded-full p-[3px]">
          {(
            [
              ["slide", "On slide"],
              ["panel", "In panel"],
            ] as const
          ).map(([v, text]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={placement === v}
              onClick={() => setPlacement(v)}
              className={`apple-press apple-focus rounded-full px-2.5 py-1 text-[11px] font-medium ${
                placement === v ? "apple-seg-on text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {/* The pop-up portals in here; :empty keeps it from taking space while no explanation is open. */}
      {placement === "panel" && <div ref={explanationRef} className="mx-2 mt-2 shrink-0 empty:hidden" />}
      <div className="m-2.5 shrink-0">
        <Segmented
          kind="tabs"
          label="Lesson"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ value: t, label: t }))}
          className="w-full"
          buttonClassName="flex-1 justify-center px-2"
        />
      </div>
      <div role="tabpanel" aria-label={tab} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
        {tab === "Key points" && <KeyPoints points={p.points} covered={p.covered} />}
        {tab === "Check yourself" && (
          <CheckYourself check={p.check} ideaNo={p.ideaNo} concepts={p.concepts} tutorName={p.tutorName} onAnswer={p.onAnswer} />
        )}
        {tab === "Materials" && <Materials trackId={p.trackId} data={p.data} onTrack={p.onTrack} deck={p.deck} lessonId={p.lessonId} />}
      </div>
    </section>
  );
}
