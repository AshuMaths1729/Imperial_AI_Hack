"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, Check, Circle, FileText, Link2, Send, X } from "lucide-react";
import { SlidesStage, type Deck } from "@/tutor/slides";
import { getLessonState, getTrack, type KP, type Lesson, type LessonState, type Track } from "./api";
import { AddMaterial } from "./AddMaterial";
import type { KeyPoint } from "./lesson";

/** `load()` once, then every 4 s while `poll` is on; a failed poll keeps the last good data and the next one retries. */
function usePoll<T>(load: (() => Promise<T>) | null, key: string, poll: boolean) {
  const [data, setData] = useState<T>();
  useEffect(() => {
    if (!load) return;
    let alive = true;
    const run = () => load().then((d) => alive && setData(d), () => {});
    void run();
    const timer = poll ? setInterval(run, 4000) : undefined;
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
export const useTrackData = (trackId: string, poll: boolean) => usePoll<TrackData>(() => getTrack(trackId), trackId, poll);
/** The agent's lesson-state checkpoint: position, detours, and how each checked concept went. */
export const useLessonState = (lessonId: string | undefined, poll: boolean) =>
  usePoll<LessonState | null>(lessonId ? () => getLessonState(lessonId) : null, lessonId ?? "", poll)[0];

const label = "font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--st-muted)]";

const STATUS: Record<KP["status"], { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-black/5 text-[var(--st-muted)]" },
  introduced: { label: "Introduced", cls: "bg-[var(--st-warn-soft)] text-[var(--st-warn)]" },
  understood: { label: "Understood", cls: "bg-[var(--st-accent-soft)] text-[var(--st-accent)]" },
};

export function LessonPanel({ track, lessons, lessonId }: { track: Track; lessons: Lesson[]; lessonId?: string }) {
  const kps = track.knowledge_points;
  const done = kps.filter((k) => k.status === "understood").length;
  const current = lessons.find((l) => l.lesson_id === lessonId && l.ended_at);
  const lastTime = lessons.find((l) => l.lesson_id !== lessonId && l.ended_at && l.summary);
  return (
    <div className="space-y-5">
      {current && (
        <section aria-label="Lesson recap" className="rounded-xl border border-[var(--st-accent-border)] bg-[var(--st-accent-soft)] p-3">
          <h3 className={`mb-1 ${label}`}>This lesson</h3>
          <p className="text-sm leading-relaxed">{current.summary || "No summary yet."}</p>
          {current.struggles.length > 0 && (
            <p className="mt-2 text-xs text-[var(--st-muted)]">To practise: {current.struggles.map((s) => s.what).join("; ")}</p>
          )}
        </section>
      )}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className={label}>Knowledge points</h3>
          <span className="font-mono text-[11px] tabular-nums text-[var(--st-muted)]">
            {done}/{kps.length} understood
          </span>
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-[var(--st-accent)] transition-[width] duration-500 ease-out"
            style={{ width: `${kps.length ? (done / kps.length) * 100 : 0}%` }}
          />
        </div>
        {kps.length === 0 ? (
          <p className="text-xs text-[var(--st-muted)]">No knowledge points yet. Add material to this track.</p>
        ) : (
          <ul className="space-y-1.5">
            {kps.map((k) => (
              <li key={k.kp_id} className="flex items-start justify-between gap-2 py-1">
                <span className="text-sm">{k.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[k.status].cls}`}>{STATUS[k.status].label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {lastTime && (
        <section>
          <h3 className={`mb-1 ${label}`}>Last time</h3>
          <p className="text-sm leading-relaxed text-[var(--st-text-2)]">{lastTime.summary}</p>
        </section>
      )}
    </div>
  );
}

function KeyPoints({ points, covered }: { points: KeyPoint[]; covered: number }) {
  if (!points.length) return <p className="text-xs text-[var(--st-muted)]">The key points of this lesson appear here once the slides are ready.</p>;
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
              p.state === "now" ? "bg-[var(--st-accent-soft)] ring-1 ring-[var(--st-accent-border)]" : ""
            }`}
          >
            <span className="mt-0.5 shrink-0" aria-hidden>
              {p.state === "done" ? (
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--st-accent)] text-[var(--st-accent-fg)]">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : p.state === "now" ? (
                <span className="grid h-4 w-4 place-items-center rounded-full border-2 border-[var(--st-accent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--st-accent)]" />
                </span>
              ) : (
                <Circle className="h-4 w-4 text-[var(--st-line-strong)]" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-mono text-[10.5px] text-[var(--st-muted)]">{String(i + 1).padStart(2, "0")} · </span>
              <span className={p.state === "upcoming" ? "text-[var(--st-muted)]" : p.state === "now" ? "font-medium" : "text-[var(--st-text-2)]"}>
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
  got_it: { label: "Got it", cls: "bg-[var(--st-accent-soft)] text-[var(--st-accent)]" },
  shaky: { label: "Shaky", cls: "bg-[var(--st-warn-soft)] text-[var(--st-warn)]" },
  not_yet: { label: "Not yet", cls: "bg-[var(--st-danger-soft)] text-[var(--st-danger)]" },
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
            <p className="text-[15px] font-medium leading-snug">{check}</p>
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
                className="min-h-11 flex-1 resize-none rounded-xl border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 py-2 text-sm placeholder-[var(--st-muted)] focus:border-[var(--st-accent)] focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Send answer"
                disabled={!text.trim()}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--st-accent)] text-[var(--st-accent-fg)] transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-[var(--st-accent-hover)] active:scale-[0.95] disabled:opacity-40"
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </form>
            {sent && (
              <p role="status" className="text-xs text-[var(--st-accent)]">
                Sent to {tutorName}.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--st-muted)]">No question on this slide. {tutorName} asks one at the end of each idea.</p>
        )}
      </section>
      <section className="space-y-2">
        <h3 className={label}>Earlier checks</h3>
        {earlier.length === 0 ? (
          <p className="text-xs text-[var(--st-muted)]">How each check went appears here.</p>
        ) : (
          <ul className="space-y-2">
            {earlier.map((c) => (
              <li key={c.concept} className="rounded-xl border border-[var(--st-line)] bg-[var(--st-surface)] px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium first-letter:uppercase">{c.concept}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${LEVEL[c.level!].cls}`}>{LEVEL[c.level!].label}</span>
                </div>
                {c.evidence && <p className="mt-0.5 text-xs leading-relaxed text-[var(--st-muted)]">{c.evidence}</p>}
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
  return (
    <div role="dialog" aria-modal="true" aria-label="Course content" className="fixed inset-0 z-50 flex items-center justify-center bg-[#13201a]/60 p-4 backdrop-blur-sm">
      <div className="st-glass flex max-h-full w-full max-w-6xl flex-col gap-3 overflow-y-auto rounded-[20px] p-3 lg:flex-row">
        <div className="relative aspect-video w-full overflow-hidden rounded-[14px] lg:flex-1">
          <SlidesStage deck={deck} />
        </div>
        <div className="min-w-0 space-y-3 p-1 lg:w-80">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Course content</h2>
            <button type="button" onClick={onClose} aria-label="Close course content" className="grid h-8 w-8 place-items-center rounded-full text-[var(--st-muted)] transition-colors hover:bg-black/5 hover:text-[var(--st-text)]">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {data ? <LessonPanel {...data} lessonId={lessonId} /> : <p className="text-xs text-[var(--st-muted)]">Loading…</p>}
        </div>
      </div>
    </div>
  );
}

function Materials({ trackId, data, onTrack, deck, lessonId }: { trackId: string; data?: TrackData; onTrack: (t: Track) => void; deck: Deck | null; lessonId?: string }) {
  const [review, setReview] = useState(false);
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setReview(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 py-2.5 text-left transition-[transform,border-color] duration-150 ease-out hover:border-[var(--st-accent)] active:scale-[0.99]"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-[var(--st-accent)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Review course content</span>
          <span className="block text-xs text-[var(--st-muted)]">
            {deck ? `${deck.slides.length} slides` : "Slides"} and knowledge points of this lesson
          </span>
        </span>
      </button>
      <section className="space-y-2">
        <h3 className={label}>Sources</h3>
        <ul className="space-y-1.5">
          {data?.track.materials.map((m, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              {m.kind === "url" ? (
                <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--st-muted)]" aria-hidden />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--st-muted)]" aria-hidden />
              )}
              <span className="truncate" title={m.ref}>
                {m.dataset_title || m.ref}
              </span>
            </li>
          ))}
          {data && !data.track.materials.length && <li className="text-xs text-[var(--st-muted)]">No materials yet.</li>}
        </ul>
      </section>
      <AddMaterial trackId={trackId} onAdded={onTrack} />
      <p className="text-[11px] text-[var(--st-muted)]">Slides prepared now open in your next lesson.</p>
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
    <section aria-label="Side panel" className="st-glass flex min-h-80 flex-1 flex-col rounded-[20px] lg:min-h-0">
      <div className="mx-3 mt-2.5 flex shrink-0 items-center justify-between gap-2">
        <span id="explanations-label" className={label}>
          Explanations
        </span>
        <div role="radiogroup" aria-labelledby="explanations-label" className="flex gap-0.5 rounded-full bg-black/5 p-0.5">
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
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 ${
                placement === v ? "bg-[var(--st-surface)] text-[var(--st-text)] shadow-sm" : "text-[var(--st-muted)] hover:text-[var(--st-text)]"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {/* The pop-up portals in here; :empty keeps it from taking space while no explanation is open. */}
      {placement === "panel" && <div ref={explanationRef} className="mx-2 mt-2 shrink-0 empty:hidden" />}
      <div role="tablist" aria-label="Lesson" className="m-2 flex shrink-0 gap-1 rounded-full bg-black/5 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors duration-150 ${
              tab === t ? "bg-[var(--st-accent)] text-[var(--st-accent-fg)] shadow-sm" : "text-[var(--st-text-2)] hover:bg-black/5"
            }`}
          >
            {t}
          </button>
        ))}
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
