"use client";

import "katex/dist/katex.min.css";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Lightbulb, Loader2, Presentation, RotateCcw, Sparkles } from "lucide-react";
import type { CircleEvent } from "@/tutor/contracts/types";
import { describeDeck, editSlide, emptyDeck, goTo, pushSlide, slideErrors, stepTo, type DeckState, type Result } from "./deck";
import { LaserDot, type Aim } from "./LaserDot";
import { bboxOf, hitItems, objectBoxes, slidePng } from "./lasso";
import { CANVAS, mainObject, objColor, stateAt, stepCount, stepMs } from "./scene";
import { SlideView } from "./SlideView";
import type { Deck, Slide, SlidesHandle, SlidesReply } from "./types";

const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const FADE_MS = 700; // slide-to-slide cross-fade
/** A step that plays with no laser cue for this long (after its main object starts entering) gets the laser on it (G1). */
export const AUTO_POINT_MS = 900;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Scale factor that fits the 1600x900 canvas into the element. */
function useFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setK(Math.max(0.1, Math.min(e.contentRect.width / CANVAS.w, e.contentRect.height / CANVAS.h))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, k] as const;
}

/** A student's circle: stays drawn (with a "?") until the tutor clears it by id. `items`: the object ids it encloses. */
type Mark = { id: string; slideId: string; pts: { x: number; y: number }[]; items: string[] };
/** The explanation pop-up: its own small slide; `focus` is what stays highlighted on the main slide meanwhile. */
type Explanation = { slide: Slide; step: number; focus: string[]; key: number };
const park = (a: Aim): Aim => ({ id: null, nonce: a.nonce + 1 });
const newCircleId = () => `slide-circle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

type Props = {
  deck: Deck | null;
  loading?: boolean;
  circleMode?: boolean;
  onCircle?: (e: CircleEvent) => void;
  ref?: Ref<SlidesHandle | null>;
  /** Where the explanation pop-up renders: an element in the side panel, or null for the stage's bottom-right corner. */
  explanationSlot?: HTMLElement | null;
};

export function SlidesStage({ deck, loading, circleMode = false, onCircle, ref, explanationSlot }: Props) {
  const reduced = useReducedMotion();
  const [fitRef, k] = useFit();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<DeckState>(() => emptyDeck(deck?.slides ?? []));
  const stRef = useRef<DeckState>(st); // the RPC handle answers synchronously, before React re-renders
  // The laser is always on: parked near the title when a slide opens, then wherever it last pointed.
  const [aim, setAim] = useState<Aim>({ id: null, nonce: 0 });
  const [popAim, setPopAim] = useState<Aim>({ id: null, nonce: 0 });
  const [ex, setExState] = useState<Explanation | null>(null);
  const exRef = useRef<Explanation | null>(null);
  const setEx = (next: Explanation | null) => {
    exRef.current = next;
    setExState(next);
  };
  const [laserIn, setLaserIn] = useState<"main" | "pop">("main");
  const popRoot = useRef<HTMLDivElement>(null);
  const cues = useRef(0); // point() calls so far: a step's auto-point is skipped when a cue arrived after the step
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [marks, setMarksState] = useState<Mark[]>([]);
  const marksRef = useRef<Mark[]>(marks);
  const clearedRef = useRef(new Set<string>()); // circles an edit already cleared: a later ui.clear_circle for them is a no-op
  const setMarks = (next: Mark[]) => {
    marksRef.current = next;
    setMarksState(next);
  };
  const [leaving, setLeaving] = useState<{ slide: Slide; step: number; key: number } | null>(null);
  const leaveSeq = useRef(0); // a fresh key per slide change restarts the exit cross-fade
  const [lasso, setLasso] = useState<{ x: number; y: number }[] | null>(null);

  const commit = (next: DeckState) => {
    const cur = stRef.current;
    const was = cur.slides[cur.index];
    if (was && next.slides[next.index]?.id !== was.id && !reduced) setLeaving({ slide: was, step: cur.step, key: ++leaveSeq.current });
    if (next.slides[next.index]?.id !== was?.id) {
      setAim(park);
      clearTimeout(autoTimer.current);
      if (exRef.current) closeEx(); // the pop-up explained something on the slide being left
    }
    stRef.current = next;
    setSt(next);
  };
  const reply = (r: Result): SlidesReply => {
    if (!r.errors.length) commit(r.state);
    return { ok: !r.errors.length, errors: r.errors, index: r.state.index + 1, step: r.state.step };
  };

  const closeEx = () => {
    setEx(null);
    setLaserIn("main");
  };

  /** Aims the laser at `id`: an object of the open explanation pop-up first, else of the open slide. */
  const pointAt = (id: string): SlidesReply => {
    const pop = exRef.current;
    const popObj = pop?.slide.objects.find((o) => o.id === id);
    if (pop && popObj) {
      if (!stateAt(pop.slide, pop.step).visible.has(id)) return { ok: false, errors: [`${id} is not on screen in the explanation yet; play its step first`] };
      setPopAim((a) => ({ id, kind: popObj.kind, color: objColor(popObj), nonce: a.nonce + 1 }));
      setLaserIn("pop");
      return { ok: true, errors: [], step: pop.step };
    }
    const cur = stRef.current;
    const slide = cur.slides[cur.index];
    if (!slide) return { ok: false, errors: ["no slides are loaded"] };
    const o = slide.objects.find((x) => x.id === id);
    if (!o) return { ok: false, errors: [`no object ${id} on this slide${pop ? " or in the explanation" : ""}`] };
    if (!stateAt(slide, cur.step).visible.has(id)) return { ok: false, errors: [`${id} is not on screen yet; step to it first`] };
    setAim((a) => ({ id, kind: o.kind, color: objColor(o), nonce: a.nonce + 1 }));
    setLaserIn("main");
    return { ok: true, errors: [], index: cur.index + 1, step: cur.step };
  };

  /** G1: when a step plays and no laser cue arrives for it soon, point at the step's main object. */
  const autoPoint = (main: { id: string; at: number } | null) => {
    clearTimeout(autoTimer.current);
    if (!main) return;
    const seen = cues.current;
    autoTimer.current = setTimeout(() => {
      if (cues.current === seen) pointAt(main.id);
    }, main.at + AUTO_POINT_MS);
  };
  useEffect(() => () => clearTimeout(autoTimer.current), []);

  // A newly loaded deck replaces the old one (before the lesson starts, or after a regeneration).
  useEffect(() => {
    stRef.current = emptyDeck(deck?.slides ?? []);
    setSt(stRef.current);
    setAim(park);
    marksRef.current = [];
    setMarksState([]);
    closeEx();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the deck changes
  }, [deck]);

  useImperativeHandle(ref, (): SlidesHandle => ({
    go: (n) => reply(goTo(stRef.current, n)),
    step: (n) => {
      const cur = stRef.current;
      const r = reply(stepTo(cur, n));
      const slide = cur.slides[cur.index];
      if (r.ok && slide && n === cur.step + 1) autoPoint(mainObject(slide, slide.steps?.[n - 1]));
      return r.ok && slide ? { ...r, ms: reduced ? 0 : stepMs(slide, cur.step, n) } : r;
    },
    describe: () => describeDeck(stRef.current),
    current: () => stRef.current.slides[stRef.current.index] ?? null,
    push: (raw) => reply(pushSlide(stRef.current, raw)),
    edit: (patch) => {
      // the tutor starts explaining on this slide: the student's circles on it have done their job
      const open = stRef.current.slides[stRef.current.index];
      const done = marksRef.current.filter((m) => m.slideId === open?.id);
      if (done.length) {
        done.forEach((m) => clearedRef.current.add(m.id));
        setMarks(marksRef.current.filter((m) => m.slideId !== open?.id));
      }
      const r = editSlide(stRef.current, patch);
      const out = reply(r);
      return out.ok ? { ...out, steps_added: r.newSteps.length, new_steps: r.newSteps } : out;
    },
    explain: (raw) => {
      const errors = slideErrors(raw);
      if (errors.length) return { ok: false, errors };
      const cur = stRef.current;
      const open = cur.slides[cur.index];
      // the main slide stays as it is; only what the student circled on it is highlighted
      const focus = [...new Set(marksRef.current.filter((m) => m.slideId === open?.id).flatMap((m) => m.items))];
      setEx({ slide: raw as Slide, step: 0, focus, key: Date.now() });
      setPopAim(park);
      setLaserIn("pop");
      clearTimeout(autoTimer.current);
      return { ok: true, errors: [], step: 0 };
    },
    explainStep: (n) => {
      const pop = exRef.current;
      if (!pop) return { ok: false, errors: ["no explanation is open; open one with slides.explain"] };
      const max = stepCount(pop.slide);
      if (!Number.isInteger(n) || n < 0 || n > max) return { ok: false, errors: [`step must be 0..${max} in this explanation`] };
      setEx({ ...pop, step: n });
      if (n === pop.step + 1) autoPoint(mainObject(pop.slide, pop.slide.steps?.[n - 1]));
      return { ok: true, errors: [], step: n, ms: reduced ? 0 : stepMs(pop.slide, pop.step, n) };
    },
    closeExplanation: () => {
      if (exRef.current) clearTimeout(autoTimer.current);
      closeEx();
      return { ok: true, errors: [] };
    },
    clearCircle: (id) => {
      if (clearedRef.current.has(id)) return { ok: true, errors: [] };
      if (!marksRef.current.some((m) => m.id === id)) return { ok: false, errors: [`no circle ${id} on the slides`] };
      setMarks(marksRef.current.filter((m) => m.id !== id));
      return { ok: true, errors: [] };
    },
    point: (id) => {
      cues.current++;
      return pointAt(id);
    },
  }));

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), FADE_MS + 50);
    return () => clearTimeout(t);
  }, [leaving]);

  const slide = st.slides[st.index];
  const steps = slide ? stepCount(slide) : 0;
  const followup = !!slide && st.followups.includes(slide.id);

  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };
  const finishLasso = async () => {
    const pts = lasso;
    setLasso(null);
    const root = canvasRef.current?.querySelector<HTMLElement>("[data-slide-root='current']");
    if (!pts || pts.length < 4 || !root || !slide) return;
    const region = bboxOf(pts);
    if (region.w < 12 && region.h < 12) return;
    const circle_id = newCircleId();
    const item_ids = hitItems(pts, objectBoxes(root));
    setMarks([...marksRef.current, { id: circle_id, slideId: slide.id, pts, items: item_ids }]);
    let png = "";
    try {
      png = await slidePng(root, region);
    } catch {
      png = ""; // the tutor still gets the slide and the circled object ids
    }
    onCircle?.({ source: "slide", slide_id: slide.id, item_ids, region, png_b64: png, circle_id });
  };

  const prev = () => reply(st.step > 0 ? stepTo(st, st.step - 1) : goTo(st, st.index)); // index is 0-based: previous slide
  const next = () => reply(st.step < steps ? stepTo(st, st.step + 1) : goTo(st, st.index + 2));
  const replay = () => {
    if (st.step === 0) return;
    reply(stepTo(stRef.current, st.step - 1));
    requestAnimationFrame(() => reply(stepTo(stRef.current, stRef.current.step + 1)));
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: "radial-gradient(120% 90% at 50% 40%, #12151d 0%, #0b0d12 60%, #07080b 100%)" }}>
      <style>{`
        @keyframes slide-leave { to { opacity: 0; transform: scale(0.985); filter: blur(2px); } }
        @keyframes slide-enter { from { opacity: 0; transform: scale(1.01); } }
        @keyframes circle-badge { from { opacity: 0; transform: translate(-50%,-50%) scale(.4); } }
        @keyframes explain-in { from { opacity: 0; transform: translateY(12px) scale(.98); } }
        @media (prefers-reduced-motion: reduce) { [data-slide-root] { animation: none !important; } }
      `}</style>
      <div ref={fitRef} className="relative min-h-0 flex-1">
        {!slide ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading slides…
              </>
            ) : (
              <>
                <Presentation className="h-6 w-6 text-slate-600" aria-hidden />
                <p>No slides for this track yet. Prepare them in the lobby before the lesson.</p>
              </>
            )}
          </div>
        ) : (
          <div
            ref={canvasRef}
            role="region"
            aria-label={`Slide ${st.index + 1} of ${st.slides.length}: ${slide.title}`}
            className="absolute left-1/2 top-1/2"
            style={{ width: CANVAS.w, height: CANVAS.h, transform: `translate(-50%,-50%) scale(${k})` }}
          >
            {leaving && (
              <div key={leaving.key} data-slide-root="leaving" className="pointer-events-none absolute inset-0" style={{ animation: `slide-leave ${FADE_MS}ms ${EASE} forwards` }}>
                <SlideView slide={leaving.slide} step={leaving.step} motion={false} />
              </div>
            )}
            <div
              key={`${st.index}:${slide.id}`}
              data-slide-root="current"
              className="absolute inset-0"
              style={{ animation: leaving ? `slide-enter ${FADE_MS}ms ${EASE} both` : undefined }}
            >
              <SlideView slide={slide} step={st.step} motion={!reduced} highlight={ex?.focus} />
            </div>
            {followup && (
              <span className="absolute flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 text-[22px] font-medium text-violet-200" style={{ right: 80, top: 52 }}>
                <Sparkles className="h-5 w-5" aria-hidden /> New animation
              </span>
            )}
            {marks.filter((m) => m.slideId === slide.id).map((m) => {
              const b = bboxOf(m.pts);
              return (
                <div key={m.id} data-testid="slide-circle" data-circle-id={m.id} aria-hidden className="pointer-events-none absolute inset-0">
                  <svg width={CANVAS.w} height={CANVAS.h} className="absolute inset-0">
                    <polygon points={m.pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(239,68,68,0.06)" stroke="#f87171" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span
                    className="absolute grid h-11 w-11 place-items-center rounded-full bg-red-500 text-[26px] font-bold text-white shadow-lg"
                    style={{ left: b.x + b.w, top: b.y, transform: "translate(-50%,-50%)", animation: reduced ? undefined : `circle-badge 300ms ${EASE} both` }}
                  >
                    ?
                  </span>
                </div>
              );
            })}
            <LaserDot
              testId="slide-laser"
              aim={aim}
              root={() => canvasRef.current?.querySelector<HTMLElement>("[data-slide-root='current']") ?? null}
              k={k}
              reduced={reduced}
              hidden={!!ex && laserIn === "pop"}
            />
            {circleMode && (
              <svg
                data-testid="slide-lasso"
                className="absolute inset-0 cursor-crosshair touch-none select-none"
                width={CANVAS.w}
                height={CANVAS.h}
                onPointerDown={(e) => {
                  e.preventDefault(); // a lasso drag must not also select the slide's text
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setLasso([toCanvas(e)]);
                }}
                onPointerMove={(e) => lasso && setLasso([...lasso, toCanvas(e)])}
                onPointerUp={() => void finishLasso()}
                onPointerCancel={() => setLasso(null)}
              >
                <rect width={CANVAS.w} height={CANVAS.h} fill="rgba(239,68,68,0.04)" />
                {lasso && <polyline points={lasso.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(239,68,68,0.08)" stroke="#f87171" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
            )}
          </div>
        )}
      </div>

      {ex &&
        (explanationSlot ? (
          createPortal(<ExplanationCard ex={ex} aim={popAim} laserOn={laserIn === "pop"} reduced={reduced} rootRef={popRoot} docked />, explanationSlot)
        ) : (
          <div className="absolute bottom-14 right-3 z-10 w-[38%] min-w-[240px]">
            <ExplanationCard ex={ex} aim={popAim} laserOn={laserIn === "pop"} reduced={reduced} rootRef={popRoot} />
          </div>
        ))}

      {slide && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          {/* Thick glass: the pill floats over the dark slide, so its text needs a solid-enough ground in every theme. */}
          <div className="apple-glass-elevated pointer-events-auto flex items-center gap-1 rounded-full border px-1.5 py-1 text-[11px] font-medium text-[var(--text-primary)]">
            <button aria-label="Previous" onClick={prev} disabled={st.index === 0 && st.step === 0} className="apple-press apple-focus grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="px-1 tabular-nums" aria-live="polite">
              {st.index + 1} / {st.slides.length}
            </span>
            <span className="flex items-center gap-1 px-1" aria-label={`Step ${st.step} of ${steps}`}>
              {Array.from({ length: steps }, (_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${i < st.step ? "w-3 bg-[var(--accent)]" : "w-1.5 bg-[var(--border-strong)]"}`} />
              ))}
            </span>
            <button aria-label="Replay step" onClick={replay} disabled={st.step === 0} className="apple-press apple-focus grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button aria-label="Next" onClick={next} disabled={st.index === st.slides.length - 1 && st.step === steps} className="apple-press apple-focus grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The explanation pop-up (G2): a card with its own small animated slide, scaled to fit, and its own laser. Docked in
 * the shell's side panel it is the slot's only child and bounds its own height (the panel's tabs stay usable).
 */
function ExplanationCard({ ex, aim, laserOn, reduced, rootRef, docked }: { ex: Explanation; aim: Aim; laserOn: boolean; reduced: boolean; rootRef: React.RefObject<HTMLDivElement | null>; docked?: boolean }) {
  const [fitRef, k] = useFit();
  const steps = stepCount(ex.slide);
  return (
    <section
      data-testid="explanation"
      aria-label={`Explaining: ${ex.slide.title}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-[var(--accent-border)] bg-[#0b0d12] shadow-[var(--shadow-elevated)]"
      style={{ animation: reduced ? undefined : `explain-in 280ms ${EASE} both`, maxHeight: docked ? "45vh" : undefined }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-solid)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]">
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Explaining: {ex.slide.title}</span>
        {steps > 0 && (
          <span className="flex items-center gap-1" aria-label={`Step ${ex.step} of ${steps}`}>
            {Array.from({ length: steps }, (_, i) => (
              <span key={i} className={`h-1 rounded-full transition-[width,background-color] duration-300 ${i < ex.step ? "w-2.5 bg-[var(--accent)]" : "w-1 bg-[var(--border-strong)]"}`} />
            ))}
          </span>
        )}
      </header>
      <div ref={fitRef} className="relative min-h-0 w-full" style={{ aspectRatio: "16 / 9", maxHeight: docked ? "calc(45vh - 2rem)" : undefined }}>
        <div className="absolute left-1/2 top-1/2" style={{ width: CANVAS.w, height: CANVAS.h, transform: `translate(-50%,-50%) scale(${k})` }}>
          <div key={ex.key} ref={rootRef} className="absolute inset-0">
            <SlideView slide={ex.slide} step={ex.step} motion={!reduced} bare />
          </div>
          <LaserDot testId="explain-laser" aim={aim} root={() => rootRef.current} k={k} reduced={reduced} hidden={!laserOn} />
        </div>
      </div>
    </section>
  );
}
