"use client";

import { useRef, useState } from "react";
import type { CircleEvent } from "@/tutor/contracts/types";
import diff from "./decks/differentiation.json";
import gd from "./decks/gradient-descent.json";
import { makeSlidesRpcHandlers, type SlidesRpcMethod } from "./rpc";
import { SlidesStage } from "./SlidesStage";
import type { Deck, Slide, SlidesHandle } from "./types";

const DECKS = { gd: gd as unknown as Deck, diff: diff as unknown as Deck };

// What slide_animate might push: the learning-rate picture with a slider for eta.
const FOLLOWUP: Slide = {
  id: "eta_play",
  title: "Drag the step size",
  kp_ids: ["gd3"],
  objects: [
    { kind: "axes", id: "ax", x: 160, y: 190, w: 960, h: 600, x_range: [-3, 3], y_range: [0, 6], x_label: "θ", y_label: "L" },
    { kind: "curve", id: "loss", axes: "ax", expr: "0.4*(x-0.5)^2+0.5", color: "blue" },
    { kind: "dot", id: "q", axes: "ax", curve: "loss", x: -2.5, color: "gold" },
    { kind: "step_arrow", id: "st", dot: "q", scale: 0.9, color: "green", label: "−η∇L" },
    { kind: "curve", id: "bowl", axes: "ax", expr: "k*(x-0.5)^2+0.5", color: "teal", label: "steeper?" },
    { kind: "slider", id: "kslider", param: "k", min: 0.1, max: 1.5, value: 0.4, x: 1180, y: 420, w: 360, label: "curvature", color: "teal" },
  ],
  steps: [
    { narration: "Same valley; the arrow is one step.", actions: [{ do: "show", ids: ["ax", "loss", "q", "st"] }] },
    { narration: "Now drag the curvature and watch the valley change.", actions: [{ do: "show", ids: ["bowl", "kslider"] }] },
    { narration: "Step and step again.", actions: [{ do: "path", id: "q", xs: [-0.34, 0.265, 0.434, 0.482] }] },
  ],
};

// What slide_edit might add to the open slide: a formula written in, then a note, as two inserted steps.
const editPatch = (n: number) => ({
  objects: [
    { kind: "math", id: `e${n}_eq`, latex: "\\frac{dL}{d\\theta} \\approx \\frac{L(\\theta+h)-L(\\theta)}{h}", x: 1260, y: 230 + (n % 3) * 150, color: "yellow" },
    { kind: "text", id: `e${n}_note`, text: "slope = rise / run", x: 1260, y: 300 + (n % 3) * 150, size: 28, color: "teal" },
  ],
  steps: [
    { narration: "Here is the slope written out.", actions: [{ do: "show", ids: [`e${n}_eq`] }] },
    { narration: "In words.", actions: [{ do: "show", ids: [`e${n}_note`] }] },
  ],
});

// What slides.explain might open: a small rise-over-run picture (ids are new on the main slide).
const EXPLAIN: Slide = {
  id: "why_rise_run",
  title: "Why gradient = rise ÷ run",
  objects: [
    { kind: "axes", id: "w_ax", x: 160, y: 120, w: 760, h: 640, x_range: [0, 4], y_range: [0, 8], x_label: "x", y_label: "y" },
    { kind: "curve", id: "w_line", axes: "w_ax", expr: "2*x", color: "blue", label: "y = 2x" },
    { kind: "polyline", id: "w_run", axes: "w_ax", points: [[1, 2], [3, 2]], color: "green" },
    { kind: "polyline", id: "w_rise", axes: "w_ax", points: [[3, 2], [3, 6]], color: "purple" },
    { kind: "math", id: "w_eq", latex: "\\frac{\\textcolor{#B08CD9}{\\text{rise}}}{\\textcolor{#83C167}{\\text{run}}} = \\frac{4}{2} = 2", x: 1250, y: 420, size: 64 },
  ],
  steps: [
    { narration: "Go along: that is the run.", actions: [{ do: "show", ids: ["w_run"] }] },
    { narration: "Then up: that is the rise.", actions: [{ do: "show", ids: ["w_rise"] }] },
    { narration: "Rise over run gives the gradient.", actions: [{ do: "show", ids: ["w_eq"] }] },
  ],
};

/** Dev-only: the fallback deck in the Slides tab, driven through the same RPC handlers the agent uses. */
export function SlidesHarness() {
  const handle = useRef<SlidesHandle | null>(null);
  const [circle, setCircle] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [crop, setCrop] = useState<string>();
  const [circles, setCircles] = useState<string[]>([]);
  const edits = useRef(0);
  const [which, setWhich] = useState<keyof typeof DECKS>("gd");
  const deck = DECKS[which];
  const [docked, setDocked] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const call = async (method: SlidesRpcMethod, payload: object) => {
    const rpc = makeSlidesRpcHandlers(() => ({ showTab: () => {}, slides: handle.current, clearCircle: (id) => handle.current?.clearCircle(id) }));
    const reply = await rpc[method](JSON.stringify(payload));
    setLog((l) => [`${method} ${JSON.stringify(payload).slice(0, 60)} → ${reply.slice(0, 160)}`, ...l].slice(0, 20));
    return JSON.parse(reply) as { ok: boolean; new_steps?: number[] };
  };
  const onCircle = (e: CircleEvent) => {
    setCircle(false);
    if (e.circle_id) setCircles((c) => [...c, e.circle_id!]);
    setCrop(e.png_b64 ? `data:image/png;base64,${e.png_b64}` : undefined);
    setLog((l) => [`circle ${JSON.stringify({ ...e, png_b64: `${e.png_b64.length} chars` })}`, ...l]);
  };
  const btn = "rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-sky-500";
  return (
    <div className="flex h-screen gap-3 bg-slate-950 p-3 text-slate-100">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800">
        <SlidesStage ref={handle} deck={deck} circleMode={circle} onCircle={onCircle} explanationSlot={docked ? slot : null} />
      </div>
      <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto text-xs">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(DECKS) as (keyof typeof DECKS)[]).map((k) => (
            <button key={k} className={`${btn} ${which === k ? "border-sky-500" : ""}`} onClick={() => setWhich(k)}>deck: {k}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {deck.slides.map((s, i) => (
            <button key={s.id} className={btn} onClick={() => call("slides.go", { index: i + 1 })}>{i + 1}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button key={n} className={btn} onClick={() => call("slides.step", { step: n })}>step {n}</button>
          ))}
        </div>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void call("slides.point", { id: new FormData(e.currentTarget).get("id") });
          }}
        >
          <input name="id" placeholder="object id" className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2" />
          <button className={btn}>point</button>
        </form>
        <div className="flex flex-wrap gap-1">
          <button className={btn} onClick={() => call("slides.push", { slide: FOLLOWUP })}>push follow-up</button>
          <button className={btn} onClick={() => call("slides.describe", {})}>describe</button>
          <button className={btn} onClick={() => call("slides.step", { step: (handle.current?.describe().step ?? 0) + 1 })}>next step</button>
          <button className={btn} onClick={() => call("slides.edit", editPatch(++edits.current))}>edit (insert 2 steps)</button>
          <button className={`${btn} ${circle ? "border-red-400" : ""}`} onClick={() => setCircle((c) => !c)}>circle</button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button className={btn} onClick={() => call("slides.explain", { slide: EXPLAIN })}>explain</button>
          {[1, 2, 3].map((n) => (
            <button key={n} className={btn} onClick={() => call("slides.explain_step", { step: n })}>ex step {n}</button>
          ))}
          <button className={btn} onClick={() => call("slides.explain_close", {})}>close</button>
          <button className={`${btn} ${docked ? "border-sky-500" : ""}`} onClick={() => setDocked((d) => !d)}>dock in slot</button>
        </div>
        {docked && <div ref={setSlot} data-testid="explain-slot" className="rounded-lg border border-dashed border-sky-700 empty:hidden" />}
        <div className="flex flex-wrap gap-1">
          {circles.map((id) => (
            <button
              key={id}
              className={btn}
              onClick={() => {
                void call("ui.clear_circle", { circle_id: id });
                setCircles((c) => c.filter((x) => x !== id));
              }}
            >
              clear {id.slice(-5)}
            </button>
          ))}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- dev harness, data: URL */}
        {crop && <img src={crop} alt="circled region" className="rounded border border-slate-700" />}
        <ol className="space-y-1 font-mono text-[10px] text-slate-400">
          {log.map((l, i) => (
            <li key={i} className="break-all">{l}</li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
