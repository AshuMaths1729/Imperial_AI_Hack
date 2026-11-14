"use client";

import "katex/dist/katex.min.css";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { ChevronLeft, ChevronRight, Loader2, Presentation, RotateCcw, Sparkles } from "lucide-react";
import type { CircleEvent } from "@/tutor/contracts/types";
import { describeDeck, emptyDeck, goTo, pushSlide, stepTo, type DeckState, type Result } from "./deck";
import { bboxOf, hitItems, objectBoxes, slidePng } from "./lasso";
import { CANVAS, stateAt, stepCount } from "./scene";
import { SlideView } from "./SlideView";
import type { Deck, Slide, SlidesHandle, SlidesReply } from "./types";

const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const LASER_HOLD = 2500;

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

type Laser = { id: string; x: number; y: number; nonce: number; hold: number };

type Props = {
  deck: Deck | null;
  loading?: boolean;
  circleMode?: boolean;
  onCircle?: (e: CircleEvent) => void;
  ref?: Ref<SlidesHandle | null>;
};

export function SlidesStage({ deck, loading, circleMode = false, onCircle, ref }: Props) {
  const reduced = useReducedMotion();
  const [fitRef, k] = useFit();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<DeckState>(() => emptyDeck(deck?.slides ?? []));
  const stRef = useRef<DeckState>(st); // the RPC handle answers synchronously, before React re-renders
  const [laser, setLaser] = useState<Laser | null>(null);
  const [laserOn, setLaserOn] = useState(false);
  const [leaving, setLeaving] = useState<{ slide: Slide; step: number; key: number } | null>(null);
  const [lasso, setLasso] = useState<{ x: number; y: number }[] | null>(null);

  const commit = (next: DeckState) => {
    const cur = stRef.current;
    const was = cur.slides[cur.index];
    if (was && next.slides[next.index]?.id !== was.id && !reduced) setLeaving({ slide: was, step: cur.step, key: Date.now() });
    if (next.slides[next.index]?.id !== was?.id) setLaser(null);
    stRef.current = next;
    setSt(next);
  };
  const reply = (r: Result): SlidesReply => {
    if (!r.errors.length) commit(r.state);
    return { ok: !r.errors.length, errors: r.errors, index: r.state.index + 1, step: r.state.step };
  };

  // A newly loaded deck replaces the old one (before the lesson starts, or after a regeneration).
  useEffect(() => {
    stRef.current = emptyDeck(deck?.slides ?? []);
    setSt(stRef.current);
  }, [deck]);

  useImperativeHandle(ref, (): SlidesHandle => ({
    go: (n) => reply(goTo(stRef.current, n)),
    step: (n) => reply(stepTo(stRef.current, n)),
    describe: () => describeDeck(stRef.current),
    current: () => stRef.current.slides[stRef.current.index] ?? null,
    push: (raw) => reply(pushSlide(stRef.current, raw)),
    point: (id, holdMs) => {
      const cur = stRef.current;
      const slide = cur.slides[cur.index];
      if (!slide) return { ok: false, errors: ["no slides are loaded"] };
      if (!slide.objects.some((o) => o.id === id)) return { ok: false, errors: [`no object ${id} on this slide`] };
      if (!stateAt(slide, cur.step).visible.has(id)) return { ok: false, errors: [`${id} is not on screen yet; step to it first`] };
      setLaser((l) => ({ id, x: l?.x ?? -1, y: l?.y ?? -1, nonce: (l?.nonce ?? 0) + 1, hold: Math.min(10000, Math.max(800, holdMs ?? LASER_HOLD)) }));
      return { ok: true, errors: [], index: cur.index + 1, step: cur.step };
    },
  }));

  // Laser: glide to the object's current centre, hold, fade.
  useLayoutEffect(() => {
    if (!laser) return;
    const root = canvasRef.current?.querySelector<HTMLElement>("[data-slide-root='current']");
    const box = root && objectBoxes(root).find((b) => b.id === laser.id)?.box;
    if (!box) return;
    // text and formulas: sit just under them (like an underline) instead of covering the words
    const isText = root.querySelector(`[data-obj="${laser.id}"]`)?.tagName === "DIV";
    const x = box.x + box.w / 2, y = isText ? box.y + box.h + 14 : box.y + box.h / 2;
    if (x !== laser.x || y !== laser.y) setLaser({ ...laser, x, y });
    setLaserOn(true);
    const t = setTimeout(() => setLaserOn(false), laser.hold);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-aim only when asked to point again
  }, [laser?.nonce]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(null), 450);
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
    let png = "";
    try {
      png = await slidePng(root, region);
    } catch {
      png = ""; // the tutor still gets the slide and the circled object ids
    }
    onCircle?.({ source: "slide", slide_id: slide.id, item_ids: hitItems(pts, objectBoxes(root)), region, png_b64: png });
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
        @keyframes laser-ring { from { transform: translate(-50%,-50%) scale(0.6); opacity: .7; } to { transform: translate(-50%,-50%) scale(2.4); opacity: 0; } }
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
              <div key={leaving.key} data-slide-root="leaving" className="pointer-events-none absolute inset-0" style={{ animation: `slide-leave 420ms ${EASE} forwards` }}>
                <SlideView slide={leaving.slide} step={leaving.step} motion={false} />
              </div>
            )}
            <div
              key={`${st.index}:${slide.id}`}
              data-slide-root="current"
              className="absolute inset-0"
              style={{ animation: leaving ? `slide-enter 500ms ${EASE} both` : undefined }}
            >
              <SlideView slide={slide} step={st.step} motion={!reduced} />
            </div>
            {followup && (
              <span className="absolute flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 text-[22px] font-medium text-violet-200" style={{ right: 80, top: 52 }}>
                <Sparkles className="h-5 w-5" aria-hidden /> New animation
              </span>
            )}
            {laser && laser.x >= 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 top-0"
                style={{
                  transform: `translate(${laser.x}px, ${laser.y}px)`,
                  transition: reduced ? "opacity 200ms" : `transform 550ms ${EASE}, opacity 400ms ease-out`,
                  opacity: laserOn ? 1 : 0,
                }}
              >
                <span className="absolute left-0 top-0 h-7 w-7 rounded-full" style={{ transform: "translate(-50%,-50%)", background: "#ff3b3b", boxShadow: "0 0 18px 6px rgba(255,59,59,.55), 0 0 2px 1px #fff inset" }} />
                {!reduced && (
                  <span key={laser.nonce} className="absolute left-0 top-0 h-7 w-7 rounded-full border-2 border-red-400" style={{ animation: "laser-ring 1.1s ease-out 3" }} />
                )}
              </div>
            )}
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

      {slide && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/70 px-1.5 py-1 text-[11px] text-slate-300 shadow-lg backdrop-blur">
            <button aria-label="Previous" onClick={prev} disabled={st.index === 0 && st.step === 0} className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="px-1 tabular-nums" aria-live="polite">
              {st.index + 1} / {st.slides.length}
            </span>
            <span className="flex items-center gap-1 px-1" aria-label={`Step ${st.step} of ${steps}`}>
              {Array.from({ length: steps }, (_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${i < st.step ? "w-3 bg-sky-400" : "w-1.5 bg-slate-600"}`} />
              ))}
            </span>
            <button aria-label="Replay step" onClick={replay} disabled={st.step === 0} className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button aria-label="Next" onClick={next} disabled={st.index === st.slides.length - 1 && st.step === steps} className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
