"use client";

// One animated slide on a 1600x900 canvas. React renders the slide as it is after `step` steps; animations
// (WAAPI, fill "backwards" only) play the change from step-1 on top of that, so cancelling any of them
// snaps to the true state. Moving geometry (dots, tangents, step arrows, morphing curves) is painted by
// `paint`, both after every render and per frame while a step plays, so there is one copy of that maths.
import katex from "katex";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS,
  PALETTE,
  STAGGER,
  axesMap,
  colorOf,
  dotPoint,
  dotXAt,
  entranceMs,
  evalExpr,
  functionPath,
  paramsOf,
  place,
  slow,
  smooth,
  stateAt,
  timeline,
  type Params,
  type SceneState,
  type Timed,
} from "./scene";
import type { AxesObj, Color, DotObj, Slide, SlideObject } from "./types";

const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
const POP = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const AXIS = "#565c6b";
const MUTED = "#7d8494";
const INK = PALETTE.white;
const SERIF = "KaTeX_Main, 'Latin Modern Roman', 'Times New Roman', serif";
const MASK = "linear-gradient(90deg, #000 42%, transparent 58%)";
const HAND = "cubic-bezier(.35,.05,.6,1)"; // starts gently and keeps going, like writing
// Written left to right (no pen icon): the clip's right edge runs from -5% to 105% of the box.
const WRITE_CLIP = ["inset(-30% 105% -30% -5%)", "inset(-30% -5% -30% -5%)"];

type CurveY = (curveId: string, x: number) => number;

function niceStep(span: number) {
  const raw = span / 6;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

function AxesView({ o }: { o: AxesObj }) {
  const { X, Y } = axesMap(o);
  const [x0, x1] = o.x_range;
  const [y0, y1] = o.y_range;
  const yAt = Y(y0 <= 0 && 0 <= y1 ? 0 : y0); // x axis sits at y=0 when visible
  const xAt = X(x0 <= 0 && 0 <= x1 ? 0 : x0);
  const ticks = (lo: number, hi: number) => {
    const s = niceStep(hi - lo);
    const out: number[] = [];
    for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) if (Math.abs(v) > 1e-9) out.push(v);
    return out;
  };
  return (
    <>
      <line data-draw x1={o.x} y1={yAt} x2={o.x + o.w} y2={yAt} stroke={AXIS} strokeWidth={2.5} strokeLinecap="round" pathLength={1} />
      <line data-draw x1={xAt} y1={o.y + o.h} x2={xAt} y2={o.y} stroke={AXIS} strokeWidth={2.5} strokeLinecap="round" pathLength={1} />
      <g data-late fill={MUTED} fontFamily={SERIF} fontSize={18}>
        {ticks(x0, x1).map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} x2={X(v)} y1={yAt - 6} y2={yAt + 6} stroke={AXIS} strokeWidth={2} />
            <text x={X(v)} y={yAt + 28} textAnchor="middle">{fmt(v)}</text>
          </g>
        ))}
        {ticks(y0, y1).map((v) => (
          <g key={`y${v}`}>
            <line x1={xAt - 6} x2={xAt + 6} y1={Y(v)} y2={Y(v)} stroke={AXIS} strokeWidth={2} />
            <text x={xAt - 12} y={Y(v) + 6} textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {o.x_label && (
          <text x={o.x + o.w} y={yAt + 56} textAnchor="end" fontSize={26} fill={INK} fontStyle="italic">{o.x_label}</text>
        )}
        {o.y_label && (
          <text x={xAt + 14} y={o.y - 10} fontSize={26} fill={INK} fontStyle="italic">{o.y_label}</text>
        )}
      </g>
    </>
  );
}

function ArrowHead({ id, color }: { id: string; color: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill={color} />
    </marker>
  );
}

function Html({ slide, o, children, visible }: { slide: Slide; o: SlideObject & { x: number; y: number; axes?: string | null; align?: string }; children: React.ReactNode; visible: boolean }) {
  const p = place(slide, o);
  return (
    <div
      data-obj={o.id}
      aria-hidden={!visible}
      className="absolute whitespace-nowrap"
      style={{ left: p.x, top: p.y, transform: o.align === "left" ? "translate(0,-50%)" : "translate(-50%,-50%)", opacity: visible ? 1 : 0 }}
    >
      <div data-inner style={{ transformOrigin: "center" }}>{children}</div>
    </div>
  );
}

const katexHtml = (latex: string) => katex.renderToString(latex, { throwOnError: false, output: "html" });

/** Paints everything whose geometry depends on a dot's x or a curve's function. */
function paint(root: HTMLElement, slide: Slide, dotX: Record<string, number>, curveY: CurveY, curves: Iterable<string> | null) {
  const parts = new Map<string, SVGElement>();
  root.querySelectorAll<SVGElement>("[data-part]").forEach((el) => parts.set(`${el.dataset.o}:${el.dataset.part}`, el));
  const set = (el: SVGElement | undefined, attrs: Record<string, string | number>) => {
    if (el) for (const k in attrs) el.setAttribute(k, String(attrs[k]));
  };
  const axes = (id: string) => slide.objects.find((o): o is AxesObj => o.kind === "axes" && o.id === id);
  const dots = new Map(slide.objects.filter((o): o is DotObj => o.kind === "dot").map((d) => [d.id, d]));
  const only = curves ? new Set(curves) : null;

  for (const o of slide.objects) {
    if (o.kind === "curve" && (!only || only.has(o.id))) {
      const ax = axes(o.axes);
      if (!ax) continue;
      const xr = o.x_range ?? ax.x_range;
      set(parts.get(`${o.id}:curve`), { d: functionPath(ax, (x) => curveY(o.id, x), xr) });
      const { X, Y } = axesMap(ax);
      // label at the rightmost visible point, on the side the curve is not coming from
      const inside = (y: number) => y >= ax.y_range[0] && y <= ax.y_range[1];
      let lx = xr[1];
      for (let i = 0; i < 60 && !inside(curveY(o.id, lx)); i++) lx -= (xr[1] - xr[0]) / 60;
      const ly = curveY(o.id, lx);
      const rising = ly > curveY(o.id, lx - (xr[1] - xr[0]) / 50);
      if (Number.isFinite(ly)) set(parts.get(`${o.id}:label`), { x: X(lx) - 8, y: Y(ly) + (rising ? -18 : 40) });
    } else if (o.kind === "dot") {
      const p = dotPoint(slide, o, dotX[o.id] ?? o.x, curveY);
      const vis = p ? "visible" : "hidden";
      set(parts.get(`${o.id}:dot`), { cx: p?.x ?? 0, cy: p?.y ?? 0, visibility: vis });
      set(parts.get(`${o.id}:halo`), { cx: p?.x ?? 0, cy: p?.y ?? 0, visibility: vis });
      set(parts.get(`${o.id}:label`), { x: (p?.x ?? 0) + 16, y: (p?.y ?? 0) - 28, visibility: vis });
    } else if (o.kind === "tangent" || o.kind === "step_arrow") {
      const dot = dots.get(o.dot);
      const curveId = o.kind === "tangent" ? o.curve : dot?.curve;
      const x = dot ? (dotX[dot.id] ?? dot.x) : NaN;
      const p = dot && dotPoint(slide, dot, x, curveY);
      const line = parts.get(`${o.id}:line`);
      if (!p || !curveId) {
        set(line, { visibility: "hidden" });
        continue;
      }
      const h = 1e-4;
      const s = (curveY(curveId, x + h) - curveY(curveId, x - h)) / (2 * h);
      const { X, Y } = axesMap(p.ax);
      if (o.kind === "tangent") {
        const half = ((o.length ?? 2) / 2) * (X(1) - X(0));
        const dx = X(x + 1) - X(x), dy = Y(p.my + s) - Y(p.my);
        const n = Math.hypot(dx, dy) || 1;
        set(line, { x1: p.x - (dx / n) * half, y1: p.y - (dy / n) * half, x2: p.x + (dx / n) * half, y2: p.y + (dy / n) * half, visibility: "visible" });
      } else {
        const end = X(x - (o.scale ?? 1) * s);
        set(line, { x1: p.x, y1: p.y, x2: end, y2: p.y, visibility: Math.abs(end - p.x) < 16 ? "hidden" : "visible" });
        set(parts.get(`${o.id}:label`), { x: (p.x + end) / 2, y: p.y - 22, visibility: Math.abs(end - p.x) < 60 ? "hidden" : "visible" });
      }
    }
  }
}

type Props = {
  slide: Slide;
  step: number;
  /** false renders the state with no motion (reduced motion, or a jump the student shouldn't sit through). */
  motion: boolean;
};

export function SlideView({ slide, step, motion }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [userParams, setParams] = useState<Params>({});
  // defaults come from the slide, so sliders added by an edit work too
  const params = useMemo(() => ({ ...paramsOf(slide), ...userParams }), [slide, userParams]);
  const paramsRef = useRef(params);
  const state = useMemo(() => stateAt(slide, step), [slide, step]);
  const playing = useRef(false);
  const shownStep = useRef<number | null>(null);
  const shownSlide = useRef<Slide | null>(null);

  const finalY = (st: SceneState): CurveY => (id, x) => evalExpr(st.expr[id] ?? "", x, paramsRef.current);

  // Geometry for the true state after every render, unless a step is animating it right now.
  useLayoutEffect(() => {
    paramsRef.current = params;
    if (root.current && !playing.current) paint(root.current, slide, state.dotX, finalY(state), null);
  });

  useLayoutEffect(() => {
    const el = root.current;
    const prev = shownStep.current;
    const prevSlide = shownSlide.current;
    shownStep.current = step;
    shownSlide.current = slide;
    if (!el || !motion || typeof el.animate !== "function") return;
    // an edit added objects to the open slide (same step): the ones no step shows enter now
    const edited = prev === step && !!prevSlide && prevSlide !== slide && prevSlide.id === slide.id;
    if (prev !== null && step !== prev + 1 && !edited) return; // jumps and going back: no replay

    const anims: Animation[] = [];
    const ghosts: HTMLElement[] = [];
    const objEl = (id: string) => el.querySelector<HTMLElement | SVGElement>(`[data-obj="${id}"]`);
    const byId = new Map(slide.objects.map((o) => [o.id, o]));
    const play = (target: Element | null, frames: Keyframe[], delay: number, duration: number, easing = EASE) => {
      if (target) anims.push(target.animate(frames, { delay, duration, easing, fill: "backwards" }));
    };

    const enter = (id: string, at: number) => {
      const o = byId.get(id);
      const node = objEl(id);
      if (!o || !node) return;
      const dur = entranceMs(o);
      if (o.kind === "text" || o.kind === "math") {
        // written in left to right at speaking pace
        play(node.querySelector("[data-inner]"), [{ clipPath: WRITE_CLIP[0] }, { clipPath: WRITE_CLIP[1] }], at, dur, HAND);
      } else if (o.kind === "slider") {
        const inner = node.querySelector("[data-inner]");
        const m = { maskImage: MASK, WebkitMaskImage: MASK, maskSize: "260% 100%", WebkitMaskSize: "260% 100%" };
        play(inner, [
          { ...m, opacity: 0, maskPosition: "100% 0", WebkitMaskPosition: "100% 0", transform: "translateY(10px)" },
          { ...m, opacity: 1, maskPosition: "0% 0", WebkitMaskPosition: "0% 0", transform: "translateY(0)" },
        ], at, dur);
      } else if (o.kind === "dot") {
        play(node, [{ opacity: 0, transform: "scale(0)" }, { opacity: 1, transform: "scale(1)" }], at, dur, POP);
      } else if (o.kind === "vector" || o.kind === "step_arrow") {
        const line = node.querySelector("line");
        const sx = line?.getAttribute("x1") ?? "0", sy = line?.getAttribute("y1") ?? "0";
        const origin = { transformBox: "view-box", transformOrigin: `${sx}px ${sy}px` };
        play(node, [{ ...origin, opacity: 0, transform: "scale(0.01)" }, { ...origin, opacity: 1, transform: "scale(1)" }], at, dur);
      } else {
        play(node, [{ opacity: 0 }, { opacity: 1 }], at, slow(160), "linear");
        node.querySelectorAll("[data-draw], [data-part=curve], [data-part=line]").forEach((d) =>
          play(d, [{ strokeDasharray: "1 1", strokeDashoffset: 1 }, { strokeDasharray: "1 1", strokeDashoffset: 0 }], at, dur)
        );
        node.querySelectorAll("[data-late], [data-part=label]").forEach((d) => play(d, [{ opacity: 0 }, { opacity: 1 }], at + dur * 0.6, slow(400)));
      }
    };

    if (edited) {
      const had = new Set(prevSlide.objects.map((o) => o.id));
      slide.objects.filter((o) => !had.has(o.id) && state.visible.has(o.id)).forEach((o, i) => enter(o.id, i * STAGGER));
      return () => anims.forEach((a) => a.cancel());
    }

    if (prev === null) {
      // Slide opens: title wipes in, then whatever is visible from the start, staggered.
      play(el.querySelector("[data-title] [data-inner]"), [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], 0, slow(700));
      play(el.querySelector("[data-title-rule]"), [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], slow(150), slow(900));
      slide.objects.filter((o) => state.visible.has(o.id)).forEach((o, i) => enter(o.id, slow(250) + i * STAGGER));
      return () => anims.forEach((a) => a.cancel());
    }

    const before = stateAt(slide, prev);
    const { items, total } = timeline(slide, slide.steps?.[step - 1]?.actions ?? []);
    const morphs = new Map<string, Timed & { from: string; to: string }>();
    const moving = new Set<string>();

    for (const it of items) {
      const a = it.act;
      if (a.do === "show") a.ids.forEach((id, i) => enter(id, it.at + i * STAGGER));
      else if (a.do === "hide") a.ids.forEach((id) => play(objEl(id), [{ opacity: 1 }, { opacity: 0 }], it.at, it.dur));
      else if (a.do === "indicate")
        a.ids.forEach((id) => {
          const node = objEl(id);
          const target = node?.querySelector("[data-inner]") ?? node;
          const glow = `drop-shadow(0 0 12px ${PALETTE.yellow})`;
          play(target, [
            { transform: "scale(1)", filter: "none" },
            { transform: "scale(1.12)", filter: glow, offset: 0.4 },
            { transform: "scale(1)", filter: "none" },
          ], it.at, it.dur);
        });
      else if (a.do === "morph" && a.latex && byId.get(a.id)?.kind === "math") {
        const inner = objEl(a.id)?.querySelector<HTMLElement>("[data-inner]");
        if (inner) {
          const ghost = document.createElement("div");
          ghost.innerHTML = katexHtml(before.latex[a.id] ?? "");
          ghost.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:0;pointer-events:none";
          const span = inner.firstElementChild as HTMLElement | null;
          ghost.style.fontSize = span?.style.fontSize ?? "";
          ghost.style.color = span?.style.color ?? "";
          inner.parentElement?.appendChild(ghost);
          ghosts.push(ghost);
          play(ghost, [{ opacity: 1, transform: "translate(-50%,-50%)" }, { opacity: 0, transform: "translate(-50%,-90%)" }], it.at, it.dur * 0.7);
          play(inner, [{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0)" }], it.at + it.dur * 0.25, it.dur * 0.75);
        }
      } else if (a.do === "morph" && a.expr) morphs.set(a.id, { ...it, from: before.expr[a.id] ?? "", to: a.expr });
      else if (a.do === "move" || a.do === "path") moving.add(a.id);

      if (a.do === "path" && a.trail !== false) {
        const per = it.dur / a.xs.length;
        const first = before.trails[a.id]?.length ?? 0;
        el.querySelectorAll(`[data-trail="${a.id}"]`).forEach((m, k) => {
          if (k >= first) play(m, [{ opacity: 0 }, { opacity: 1 }], it.at + (k - first) * per, slow(200));
        });
      }
    }

    let raf = 0;
    if (moving.size || morphs.size) {
      playing.current = true;
      const t0 = performance.now();
      const curveY: (t: number) => CurveY = (t) => (id, x) => {
        const m = morphs.get(id);
        const p = paramsRef.current;
        if (m && t < m.at + m.dur) {
          const u = smooth((t - m.at) / m.dur);
          return (1 - u) * evalExpr(m.from, x, p) + u * evalExpr(m.to, x, p);
        }
        return evalExpr(state.expr[id] ?? "", x, p);
      };
      const frame = (now: number) => {
        const t = now - t0;
        const dotX = { ...state.dotX };
        for (const id of moving) dotX[id] = dotXAt(items, id, before.dotX[id], t);
        paint(el, slide, dotX, curveY(t), morphs.size ? morphs.keys() : []);
        if (t < total) raf = requestAnimationFrame(frame);
        else {
          playing.current = false;
          paint(el, slide, state.dotX, finalY(state), null);
        }
      };
      frame(t0);
    }

    return () => {
      cancelAnimationFrame(raf);
      anims.forEach((a) => a.cancel());
      ghosts.forEach((g) => g.remove());
      if (playing.current) {
        playing.current = false;
        paint(el, slide, state.dotX, finalY(state), null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plays once per step change; params are read from a ref
  }, [slide, step, motion]);

  const vis = (id: string) => state.visible.has(id);
  const gStyle = (id: string): React.CSSProperties => ({
    opacity: vis(id) ? 1 : 0,
    transformBox: "fill-box",
    transformOrigin: "center",
  });
  const markers = new Set<string>();
  const curveFn: CurveY = (id, x) => evalExpr(state.expr[id] ?? "", x, params);

  const svg: React.ReactNode[] = [];
  const html: React.ReactNode[] = [];
  for (const o of slide.objects) {
    const c = colorOf(o, o.kind === "curve" ? "blue" : o.kind === "dot" ? "gold" : o.kind === "tangent" ? "yellow" : "white");
    const clip = "axes" in o && o.axes ? `url(#clip-${slide.id}-${o.axes})` : undefined;
    const head = `head-${(o.color ?? "white")}`;
    switch (o.kind) {
      case "axes":
        svg.push(<g key={o.id} data-obj={o.id} style={gStyle(o.id)}><AxesView o={o} /></g>);
        break;
      case "curve":
        svg.push(
          <g key={o.id} data-obj={o.id} style={gStyle(o.id)}>
            <path data-part="curve" data-o={o.id} clipPath={clip} fill="none" stroke={c} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
            {o.label && <text data-part="label" data-o={o.id} textAnchor="end" fill={c} fontFamily={SERIF} fontSize={26}>{o.label}</text>}
          </g>
        );
        break;
      case "polyline": {
        const pts = o.points.map(([x, y]) => place(slide, { x, y, axes: o.axes })).map((p) => `${p.x},${p.y}`).join(" ");
        svg.push(
          <g key={o.id} data-obj={o.id} style={gStyle(o.id)}>
            <polyline data-draw points={pts} fill="none" stroke={c} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
          </g>
        );
        break;
      }
      case "dot": {
        const trail = state.trails[o.id] ?? [];
        svg.push(
          <g key={`${o.id}-trail`}>
            {trail.map((x, k) => {
              const p = dotPoint(slide, o, x, curveFn);
              return p && <circle key={k} data-trail={o.id} cx={p.x} cy={p.y} r={5} fill={c} fillOpacity={0.45} style={{ opacity: vis(o.id) ? 1 : 0 }} />;
            })}
          </g>,
          <g key={o.id} data-obj={o.id} style={gStyle(o.id)}>
            <circle data-part="halo" data-o={o.id} r={24} fill={c} fillOpacity={0.16} />
            <circle data-part="dot" data-o={o.id} r={11} fill={c} stroke="#0b0d12" strokeWidth={2} />
            {o.label && <text data-part="label" data-o={o.id} fill={c} fontFamily={SERIF} fontSize={24}>{o.label}</text>}
          </g>
        );
        break;
      }
      case "tangent":
        svg.push(
          <g key={o.id} data-obj={o.id} style={gStyle(o.id)}>
            <line data-part="line" data-o={o.id} stroke={c} strokeWidth={3.5} strokeLinecap="round" pathLength={1} />
          </g>
        );
        break;
      case "step_arrow":
        markers.add(o.color ?? "white");
        svg.push(
          <g key={o.id} data-obj={o.id} style={gStyle(o.id)}>
            <line data-part="line" data-o={o.id} stroke={c} strokeWidth={4.5} strokeLinecap="round" markerEnd={`url(#${head})`} />
            {o.label && <text data-part="label" data-o={o.id} textAnchor="middle" fill={c} fontFamily={SERIF} fontSize={24}>{o.label}</text>}
          </g>
        );
        break;
      case "vector": {
        markers.add(o.color ?? "white");
        const a = place(slide, { x: o.start[0], y: o.start[1], axes: o.axes });
        const b = place(slide, { x: o.end[0], y: o.end[1], axes: o.axes });
        svg.push(
          <g key={o.id} data-obj={o.id} style={{ opacity: vis(o.id) ? 1 : 0 }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeWidth={4.5} strokeLinecap="round" markerEnd={`url(#${head})`} />
            {o.label && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 16} textAnchor="middle" fill={c} fontFamily={SERIF} fontSize={26}>{o.label}</text>
            )}
          </g>
        );
        break;
      }
      case "shape": {
        const a = place(slide, { x: o.x, y: o.y, axes: o.axes });
        const b = place(slide, { x: o.x + o.w, y: o.y + (o.axes ? -o.h : o.h), axes: o.axes });
        const [x, y, w, h] = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)];
        const common = { "data-draw": true, stroke: c, strokeWidth: 3.5, fill: o.fill ? c : "none", fillOpacity: o.fill ? 0.18 : undefined, pathLength: 1 };
        svg.push(
          <g key={o.id} data-obj={o.id} style={gStyle(o.id)}>
            {o.shape === "rect" && <rect x={x} y={y} width={w} height={h} rx={8} {...common} />}
            {o.shape === "ellipse" && <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />}
            {o.shape === "line" && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} strokeLinecap="round" />}
          </g>
        );
        break;
      }
      case "text":
        html.push(
          <Html key={o.id} slide={slide} o={o} visible={vis(o.id)}>
            <span style={{ fontFamily: SERIF, fontSize: o.size ?? 32, color: c, whiteSpace: "pre" }}>{o.text}</span>
          </Html>
        );
        break;
      case "math":
        html.push(
          <Html key={o.id} slide={slide} o={o} visible={vis(o.id)}>
            <span style={{ fontSize: o.size ?? 40, color: c }} dangerouslySetInnerHTML={{ __html: katexHtml(state.latex[o.id] ?? o.latex) }} />
          </Html>
        );
        break;
      case "slider":
        html.push(
          <Html key={o.id} slide={slide} o={{ ...o, align: "left" }} visible={vis(o.id)}>
            <label className="flex items-center gap-4" style={{ fontFamily: SERIF, fontSize: 26, color: c, width: o.w ?? 360 }}>
              <span>{o.label || o.param}</span>
              <input
                type="range"
                min={o.min}
                max={o.max}
                step={(o.max - o.min) / 200}
                value={params[o.param] ?? o.value}
                onChange={(e) => setParams((p) => ({ ...p, [o.param]: Number(e.target.value) }))}
                className="slide-slider flex-1"
                style={{ accentColor: c }}
                aria-label={o.label || o.param}
              />
              <span className="tabular-nums" style={{ minWidth: 64 }}>{fmt(params[o.param] ?? o.value)}</span>
            </label>
          </Html>
        );
        break;
    }
  }

  return (
    <div ref={root} className="absolute inset-0" style={{ width: CANVAS.w, height: CANVAS.h }}>
      <div data-title className="absolute" style={{ left: 80, top: 44 }}>
        <div data-inner style={{ fontFamily: SERIF, fontSize: 46, color: INK, letterSpacing: 0.2 }}>{slide.title}</div>
        <div data-title-rule style={{ marginTop: 10, height: 2, width: 120, transformOrigin: "left", background: `linear-gradient(90deg, ${PALETTE.blue}, transparent)` }} />
      </div>
      <svg viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} width={CANVAS.w} height={CANVAS.h} className="absolute inset-0 overflow-visible">
        <defs>
          {slide.objects.filter((o): o is AxesObj => o.kind === "axes").map((ax) => (
            <clipPath key={ax.id} id={`clip-${slide.id}-${ax.id}`}>
              <rect x={ax.x - 4} y={ax.y - 4} width={ax.w + 8} height={ax.h + 8} />
            </clipPath>
          ))}
          {[...markers].map((m) => <ArrowHead key={m} id={`head-${m}`} color={PALETTE[m as Color] ?? INK} />)}
        </defs>
        {svg}
      </svg>
      {html}
    </div>
  );
}
