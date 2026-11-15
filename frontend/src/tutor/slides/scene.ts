// Pure slide logic: what is on screen after N steps, the animation timeline for a step, and geometry.
import functionPlot from "function-plot";
import type { Action, AxesObj, Color, CurveObj, DotObj, Slide, SlideObject, Vec } from "./types";

export const CANVAS = { w: 1600, h: 900 };

/** 3Blue1Brown-like palette on a near-black canvas. deck.py's prompt lists the same hex values. */
export const PALETTE: Record<Color, string> = {
  blue: "#58C4DD",
  teal: "#5CD0B3",
  green: "#83C167",
  yellow: "#FFE45C",
  gold: "#F0AC5F",
  red: "#FC6255",
  purple: "#B08CD9",
  pink: "#E072C8",
  white: "#ECECEC",
  grey: "#8A8F98",
};
export const colorOf = (o: { color?: Color | null }, fallback: Color = "white") => PALETTE[o.color ?? fallback] ?? PALETTE[fallback];

// function-plot caches the compiled expression on the datum object, so keep one datum per expression.
const datums = new Map<string, { fn: string }>();
/** y = expr(x) with slider params in scope; NaN when it cannot be evaluated. */
export function evalExpr(expr: string, x: number, params: Record<string, number> = {}): number {
  let d = datums.get(expr);
  if (!d) datums.set(expr, (d = { fn: expr }));
  try {
    const y = functionPlot.$eval.builtIn(d, "fn", { ...params, x });
    return typeof y === "number" ? y : NaN;
  } catch {
    return NaN;
  }
}

export const slopeAt = (expr: string, x: number, params?: Record<string, number>) => {
  const h = 1e-4;
  return (evalExpr(expr, x + h, params) - evalExpr(expr, x - h, params)) / (2 * h);
};

/** Maths units of an axes -> canvas units. */
export function axesMap(ax: AxesObj) {
  const [x0, x1] = ax.x_range;
  const [y0, y1] = ax.y_range;
  return {
    X: (x: number) => ax.x + ((x - x0) / (x1 - x0)) * ax.w,
    Y: (y: number) => ax.y + ax.h - ((y - y0) / (y1 - y0)) * ax.h,
  };
}

/** SVG path for a function on an axes; breaks the line where the function is undefined. Clipped to the axes by the renderer. */
export function functionPath(ax: AxesObj, f: (x: number) => number, xr: Vec = ax.x_range, samples = 180): string {
  const { X, Y } = axesMap(ax);
  const span = ax.y_range[1] - ax.y_range[0];
  const lo = ax.y_range[0] - 4 * span, hi = ax.y_range[1] + 4 * span; // keep far-off values from making huge numbers
  let d = "";
  let pen = false;
  for (let i = 0; i <= samples; i++) {
    const x = xr[0] + ((xr[1] - xr[0]) * i) / samples;
    const y = f(x);
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${X(x).toFixed(1)} ${Y(Math.min(hi, Math.max(lo, y))).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export type SceneState = {
  visible: Set<string>;
  dotX: Record<string, number>;
  /** xs a dot has visited on path actions (with trail), drawn as faint markers. */
  trails: Record<string, number[]>;
  latex: Record<string, string>;
  expr: Record<string, string>;
};

const shownLater = (slide: Slide) =>
  new Set((slide.steps ?? []).flatMap((s) => s.actions.flatMap((a) => (a.do === "show" ? a.ids : []))));

export function initialState(slide: Slide): SceneState {
  const later = shownLater(slide);
  const st: SceneState = { visible: new Set(), dotX: {}, trails: {}, latex: {}, expr: {} };
  for (const o of slide.objects) {
    if (!later.has(o.id)) st.visible.add(o.id);
    if (o.kind === "dot") st.dotX[o.id] = o.x;
    if (o.kind === "math") st.latex[o.id] = o.latex;
    if (o.kind === "curve") st.expr[o.id] = o.expr;
  }
  return st;
}

export function applyActions(prev: SceneState, actions: Action[]): SceneState {
  const st: SceneState = {
    visible: new Set(prev.visible),
    dotX: { ...prev.dotX },
    trails: { ...prev.trails },
    latex: { ...prev.latex },
    expr: { ...prev.expr },
  };
  for (const a of actions) {
    if (a.do === "show") a.ids.forEach((id) => st.visible.add(id));
    else if (a.do === "hide") a.ids.forEach((id) => st.visible.delete(id));
    else if (a.do === "move" && a.id in st.dotX) st.dotX[a.id] = a.to;
    else if (a.do === "path" && a.id in st.dotX && a.xs.length) {
      if (a.trail !== false) st.trails[a.id] = [...(st.trails[a.id] ?? []), st.dotX[a.id], ...a.xs.slice(0, -1)];
      st.dotX[a.id] = a.xs[a.xs.length - 1];
    } else if (a.do === "morph") {
      if (a.latex && a.id in st.latex) st.latex[a.id] = a.latex;
      if (a.expr && a.id in st.expr) st.expr[a.id] = a.expr;
    }
  }
  return st;
}

/** Scene after `step` steps (0 = the slide as it opens). */
export function stateAt(slide: Slide, step: number): SceneState {
  let st = initialState(slide);
  for (const s of (slide.steps ?? []).slice(0, Math.max(0, step))) st = applyActions(st, s.actions);
  return st;
}

export const stepCount = (slide: Slide) => slide.steps?.length ?? 0;

// ---- timeline -------------------------------------------------------------------------------------------

/** v3 pacing: every step animation runs this much slower than v2 (one idea at a time). */
export const PACE = 1.6;
export const slow = (ms: number) => Math.round(ms * PACE);
export const STAGGER = slow(110);
export const hopMs = (hops: number) => slow(Math.min(520, Math.max(110, 3600 / Math.max(1, hops))));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Rough rendered-glyph count of a LaTeX string: colour arguments, layout commands, spacing, braces, ^ and _ aren't written. */
const latexChars = (latex: string) => {
  const t = latex
    .replace(/\\(?:textcolor|color)\{[^}]*\}/g, "")
    .replace(/\\(?:frac|dfrac|tfrac|text|mathrm|mathbf|operatorname|left|right|quad|qquad)(?![a-zA-Z])|\\[,;:! ]/g, "");
  return t.replace(/\\[a-zA-Z]+|[{}^_\s]/g, "").length + (t.match(/\\[a-zA-Z]+/g)?.length ?? 0);
};

/** Speaking pace (v3.1): ~20 rendered characters take 4 s; at least 1.5 s per item. */
const WRITE_MS_PER_CHAR = 200;
/** Equations and text are written in left to right at the pace the tutor speaks. */
export function writeMs(o: SlideObject): number {
  const chars = o.kind === "math" ? latexChars(o.latex) : o.kind === "text" ? o.text.replace(/\s/g, "").length : 0;
  // shortcut: capped at 10 s so one very long line can't stall the lesson; split such lines in the deck instead
  return clamp(WRITE_MS_PER_CHAR * chars, 1500, 10_000);
}

export function entranceMs(o: SlideObject | undefined): number {
  switch (o?.kind) {
    case "math":
    case "text":
      return writeMs(o);
    case "axes":
      return slow(900);
    case "curve":
    case "polyline":
      return slow(1400);
    case "dot":
      return slow(450);
    default:
      return slow(800);
  }
}

export type Timed = { at: number; dur: number; act: Action };

/** When each action of a step starts and how long it runs (ms). Actions run in order unless with_prev. */
export function timeline(slide: Slide, actions: Action[]): { items: Timed[]; total: number } {
  const byId = new Map(slide.objects.map((o) => [o.id, o]));
  const items: Timed[] = [];
  let prevAt = 0, cursor = 0, total = 0;
  for (const act of actions) {
    let dur: number;
    if (act.do === "show") dur = (act.ids.length - 1) * STAGGER + Math.max(...act.ids.map((id) => entranceMs(byId.get(id))));
    else if (act.do === "hide") dur = slow(450);
    else if (act.do === "move") dur = slow(1100);
    else if (act.do === "path") dur = act.xs.length * hopMs(act.xs.length);
    else if (act.do === "morph") dur = slow(1000);
    else dur = slow(800);
    const at = act.with_prev ? prevAt : cursor;
    items.push({ at, dur, act });
    prevAt = at;
    cursor = Math.max(cursor, at + dur);
    total = Math.max(total, at + dur);
  }
  return { items, total };
}

/** How long going from step `from` to `to` animates (ms): only the next step is played; jumps and going back are instant. */
export const stepMs = (slide: Slide, from: number, to: number) =>
  to === from + 1 && slide.steps?.[to - 1] ? timeline(slide, slide.steps[to - 1].actions).total : 0;

/** Smooth in-out (manim's "smooth"): slow start, slow landing. */
export const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/** A dot's x at time t (ms) given the step's move/path actions; null when no action moves it. */
export function dotXAt(items: Timed[], id: string, startX: number, t: number): number {
  let x = startX;
  for (const { at, dur, act } of items) {
    if ((act.do !== "move" && act.do !== "path") || act.id !== id) continue;
    const targets = act.do === "move" ? [act.to] : act.xs;
    // a trail marks discrete iterates (ease into each); without one it is a continuous roll (no stop per hop)
    const ease = act.do === "path" && act.trail === false ? (u: number) => u : smooth;
    if (t <= at) return x;
    const per = dur / targets.length;
    for (let i = 0; i < targets.length; i++) {
      const s = at + i * per;
      if (t < s + per) return x + (targets[i] - x) * ease((t - s) / per);
      x = targets[i];
    }
  }
  return x;
}

export const curveOf = (slide: Slide, dot: DotObj) =>
  slide.objects.find((o): o is CurveObj => o.kind === "curve" && o.id === dot.curve);

export type Params = Record<string, number>;
export const paramsOf = (slide: Slide): Params =>
  Object.fromEntries(slide.objects.flatMap((o) => (o.kind === "slider" ? [[o.param, o.value]] : [])));

/** Canvas position of an object's anchor: canvas units, or axes units when it names an axes. */
export function place(slide: Slide, p: { x: number; y: number; axes?: string | null }): { x: number; y: number } {
  const ax = p.axes ? slide.objects.find((o): o is AxesObj => o.kind === "axes" && o.id === p.axes) : undefined;
  if (!ax) return { x: p.x, y: p.y };
  const { X, Y } = axesMap(ax);
  return { x: X(p.x), y: Y(p.y) };
}

/** Canvas position of a dot at x (y from its curve, or its fixed y); null when undefined there. */
export function dotPoint(slide: Slide, dot: DotObj, x: number, curveY: (curveId: string, x: number) => number) {
  const ax = slide.objects.find((o): o is AxesObj => o.kind === "axes" && o.id === dot.axes);
  if (!ax) return null;
  const y = dot.curve ? curveY(dot.curve, x) : (dot.y ?? NaN);
  if (!Number.isFinite(y)) return null;
  const { X, Y } = axesMap(ax);
  return { x: X(x), y: Y(y), ax, my: y };
}
