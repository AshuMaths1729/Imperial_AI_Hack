"use client";

import { useRef, useState } from "react";
import type { CircleEvent } from "@/tutor/contracts/types";
import gd from "./decks/gradient-descent.json";
import { makeSlidesRpcHandlers, type SlidesRpcMethod } from "./rpc";
import { SlidesStage } from "./SlidesStage";
import type { Deck, Slide, SlidesHandle } from "./types";

const deck = gd as unknown as Deck;

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

/** Dev-only: the fallback deck in the Slides tab, driven through the same RPC handlers the agent uses. */
export function SlidesHarness() {
  const handle = useRef<SlidesHandle | null>(null);
  const [circle, setCircle] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [crop, setCrop] = useState<string>();
  const call = async (method: SlidesRpcMethod, payload: object) => {
    const rpc = makeSlidesRpcHandlers(() => ({ showTab: () => {}, slides: handle.current }));
    const reply = await rpc[method](JSON.stringify(payload));
    setLog((l) => [`${method} ${JSON.stringify(payload).slice(0, 60)} → ${reply.slice(0, 160)}`, ...l].slice(0, 20));
  };
  const onCircle = (e: CircleEvent) => {
    setCircle(false);
    setCrop(e.png_b64 ? `data:image/png;base64,${e.png_b64}` : undefined);
    setLog((l) => [`circle ${JSON.stringify({ ...e, png_b64: `${e.png_b64.length} chars` })}`, ...l]);
  };
  const btn = "rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-sky-500";
  return (
    <div className="flex h-screen gap-3 bg-slate-950 p-3 text-slate-100">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800">
        <SlidesStage ref={handle} deck={deck} circleMode={circle} onCircle={onCircle} />
      </div>
      <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto text-xs">
        <div className="flex flex-wrap gap-1">
          {deck.slides.map((s, i) => (
            <button key={s.id} className={btn} onClick={() => call("slides.go", { index: i + 1 })}>{i + 1}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
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
          <button className={`${btn} ${circle ? "border-red-400" : ""}`} onClick={() => setCircle((c) => !c)}>circle</button>
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
