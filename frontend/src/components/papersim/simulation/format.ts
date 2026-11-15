/**
 * Pure helpers for the Interactive Simulation tab: number formatting, step snapping,
 * "nice" axis ticks, symbol derivation and CSV export. No React in here.
 */
import type { ParamDoc, SimulationParam } from "../../../types/scholartwin";

/** Okabe-Ito CVD-safe categorical order (fixed: colour follows the series index). */
export const SERIES_PALETTE = ["#0284c7", "#e69f00", "#009e73", "#cc79a7", "#d55e00"];
/** Dash patterns give every series a second, non-colour identity cue. */
export const SERIES_DASHES: (string | undefined)[] = [undefined, "8 4", "2 4", "10 4 2 4", "14 5"];

export function seriesColor(idx: number): string {
  return SERIES_PALETTE[idx % SERIES_PALETTE.length];
}
export function seriesDash(idx: number): string | undefined {
  // Past the palette length, shift the dash so (colour, dash) pairs stay unique.
  return SERIES_DASHES[(idx + Math.floor(idx / SERIES_PALETTE.length)) % SERIES_DASHES.length];
}

/* ---------------- numbers ---------------- */

/** Number of decimals implied by a slider step (0.25 -> 2, 1 -> 0, 1e-3 -> 3). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  if (Number.isInteger(step)) return 0;
  const s = step.toString();
  if (s.includes("e-")) return Math.min(8, parseInt(s.split("e-")[1], 10) + (s.split("e-")[0].split(".")[1]?.length ?? 0));
  return Math.min(8, s.split(".")[1]?.length ?? 2);
}

export function isIntegerParam(p: SimulationParam): boolean {
  return Number.isInteger(p.step) && Number.isInteger(p.min_val);
}

export function clampSnap(v: number, p: SimulationParam): number {
  if (!Number.isFinite(v)) return p.default_val;
  const lo = Math.min(p.min_val, p.max_val);
  const hi = Math.max(p.min_val, p.max_val);
  const clamped = Math.min(hi, Math.max(lo, v));
  if (!(p.step > 0)) return clamped;
  const snapped = lo + Math.round((clamped - lo) / p.step) * p.step;
  const d = stepDecimals(p.step);
  return Math.min(hi, Math.max(lo, Number(snapped.toFixed(Math.max(d, 0) + 2))));
}

export function formatParam(v: number, p: SimulationParam): string {
  if (!Number.isFinite(v)) return "—";
  if (isIntegerParam(p)) return Math.round(v).toString();
  const d = stepDecimals(p.step);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-4)) return v.toExponential(2);
  return v.toFixed(Math.min(d, 6));
}

const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

function sci(v: number, digits: number): string {
  const [m, e] = v.toExponential(digits).split("e");
  const exp = String(parseInt(e, 10)).split("").map((c) => SUPERSCRIPT[c] ?? c).join("");
  const mant = m.replace(/\.?0+$/, "");
  return `${mant}×10${exp}`;
}

/** General-purpose value formatter (readouts, tooltips): ~4 significant figures. */
export function formatValue(v: number | null | undefined, sig = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return sci(v, sig - 2);
  return Number(v.toPrecision(sig)).toString();
}

/** Tick label formatter: decimals follow the tick spacing so labels never look ragged. */
export function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-6) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || (abs < 1e-3 && abs > 0)) return sci(v, 1);
  const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(d);
}

/* ---------------- ticks ---------------- */

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

const clean = (v: number) => Number(v.toPrecision(12));

export interface Ticks {
  values: number[];
  step: number;
}

/** Evenly spaced round-number ticks covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { values: [], step: 1 };
  if (max <= min) return { values: [clean(min)], step: Math.abs(min) || 1 };
  const step = niceStep(max - min, count);
  const values: number[] = [];
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let v = start; v <= max + step * 1e-9 && values.length < 50; v += step) values.push(clean(v));
  return { values, step };
}

/** Extend [min, max] outward to round tick boundaries (with a little headroom). */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-12 * Math.max(1, Math.abs(max))) {
    const pad = Math.abs(min) * 0.1 || 1;
    return [min - pad, max + pad];
  }
  const step = niceStep(max - min, count);
  return [clean(Math.floor(min / step + 1e-9) * step), clean(Math.ceil(max / step - 1e-9) * step)];
}

/** Ticks for a log10 axis; `a`, `b` are the domain in log space. Returns positions in log space. */
export function logTicks(a: number, b: number): { values: number[]; labels: string[] } {
  if (b - a >= 1) {
    const ks: number[] = [];
    for (let k = Math.ceil(a - 1e-9); k <= Math.floor(b + 1e-9); k++) ks.push(k);
    const stride = Math.ceil(ks.length / 6);
    const picked = ks.filter((_, i) => i % stride === 0);
    return {
      values: picked,
      labels: picked.map((k) => (k >= -2 && k <= 3 ? clean(10 ** k).toString() : `10${String(k).split("").map((c) => SUPERSCRIPT[c] ?? c).join("")}`)),
    };
  }
  const lin = niceTicks(10 ** a, 10 ** b, 4);
  const vals = lin.values.filter((v) => v > 0);
  return { values: vals.map((v) => Math.log10(v)), labels: vals.map((v) => formatTick(v, lin.step)) };
}

/* ---------------- lookup ---------------- */

/** Index of the sample nearest to `x` (x assumed ascending; falls back to a linear scan). */
export function nearestIndex(xs: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  if (xs[n - 1] < xs[0]) {
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    return best;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}

/** Linear interpolation of a series at `x` (null outside its range). */
export function valueAt(xs: number[], ys: number[], x: number): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return null;
  if (x < xs[0] || x > xs[n - 1]) return null;
  const i = nearestIndex(xs.slice(0, n), x);
  const j = xs[i] <= x ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
  if (i === j || xs[i] === xs[j]) return Number.isFinite(ys[i]) ? ys[i] : null;
  const t = (x - xs[i]) / (xs[j] - xs[i]);
  const v = ys[i] + (ys[j] - ys[i]) * t;
  return Number.isFinite(v) ? v : null;
}

export interface SeriesStats {
  final: number | null;
  min: number | null;
  minX: number | null;
  max: number | null;
  maxX: number | null;
}

export function seriesStats(xs: number[], ys: number[]): SeriesStats {
  let min: number | null = null;
  let max: number | null = null;
  let minX: number | null = null;
  let maxX: number | null = null;
  let final: number | null = null;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const v = ys[i];
    if (!Number.isFinite(v)) continue;
    final = v;
    if (min === null || v < min) {
      min = v;
      minX = xs[i];
    }
    if (max === null || v > max) {
      max = v;
      maxX = xs[i];
    }
  }
  return { final, min, minX, max, maxX };
}

/* ---------------- symbols ---------------- */

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa",
  "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Phi", "Psi", "Omega",
];

/** LaTeX symbol for a param: docs first, else derived from the key ("theta0" -> \theta_{0}). */
export function paramSymbol(p: SimulationParam, doc?: ParamDoc): string | null {
  if (doc?.symbol_latex?.trim()) return doc.symbol_latex;
  // A symbol in parentheses at the end of the label: "Damping (γ)" / "Learning rate ($\eta$)"
  const paren = p.name.match(/\(([^()]{1,12})\)\s*$/);
  if (paren && !/\s/.test(paren[1].replace(/\$/g, ""))) return paren[1];
  const m = p.key.match(/^([A-Za-z]+)(?:_?(\d+)|_([A-Za-z0-9]{1,4}))?$/);
  if (m) {
    const base = m[1];
    const greek = GREEK.find((g) => g === base) ?? GREEK.find((g) => g.toLowerCase() === base.toLowerCase());
    const head = greek ? `\\${greek}` : base.length === 1 ? base : null;
    if (head) {
      if (m[2]) return `${head}_{${m[2]}}`;
      if (m[3]) return m[3].length === 1 ? `${head}_{${m[3]}}` : `${head}_{\\text{${m[3]}}}`;
      return head;
    }
  }
  return null;
}

/** Param name without a trailing "(symbol)" (the symbol is rendered separately). */
export function paramLabel(p: SimulationParam): string {
  return p.name.replace(/\s*\(([^()]{1,12})\)\s*$/, "").trim() || p.key;
}

/** Escape a unit for use inside \text{}. */
function texText(s: string): string {
  return s.replace(/([\\{}$&#^_%~])/g, "\\$1");
}

/** e.g. "\gamma = 0.30,\ \eta = 0.10" for pin labels. */
export function paramsLatex(
  values: Record<string, number>,
  params: SimulationParam[],
  docs: Map<string, ParamDoc>,
  onlyKeys?: string[]
): string {
  const keys = onlyKeys ?? params.map((p) => p.key);
  return params
    .filter((p) => keys.includes(p.key))
    .map((p) => {
      const sym = paramSymbol(p, docs.get(p.key)) ?? `\\text{${texText(paramLabel(p))}}`;
      return `${sym} = ${formatParam(values[p.key] ?? p.default_val, p)}`;
    })
    .join(",\\ ");
}

/* ---------------- export ---------------- */

function csvCell(v: string | number): string {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(xLabel: string, xs: number[], series: { name: string; y: number[] }[]): string {
  const header = [xLabel || "x", ...series.map((s) => s.name)].map(csvCell).join(",");
  const rows = xs.map((x, i) => [x, ...series.map((s) => s.y[i])].map(csvCell).join(","));
  return [header, ...rows].join("\n");
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "simulation";
}
