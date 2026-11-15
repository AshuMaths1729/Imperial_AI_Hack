/**
 * Pure numeric analysis of simulation series. Everything here is computed from the real
 * x / y arrays the backend returns: no invented values. Functions return `null` for any
 * statistic that does not apply (too few points, flat series, poor fit...).
 */

export type Shape =
  | "constant"
  | "increasing"
  | "decreasing"
  | "peak"
  | "valley"
  | "oscillating"
  | "irregular";

export interface Threshold {
  id: string;
  label: string;
  /** Short explanation shown under the label. */
  hint: string;
  /** x position where it happens (interpolated), or null when it never happens in the window. */
  x: number | null;
  /** Shown instead of a position when x is null. */
  never?: string;
}

export interface ExpFit {
  /** "decay": gap to the asymptote shrinks; "growth": it grows. */
  kind: "decay" | "growth";
  /** Rate constant k in y ≈ c + A·e^{kx}. */
  k: number;
  /** e-folding scale 1/|k|. */
  tau: number;
  /** ln2/|k|: half-life (decay) or doubling scale (growth). */
  half: number;
  /** Asymptote / offset c. */
  c: number;
  r2: number;
  /** "curve" = fit of the series itself, "envelope" = fit of oscillation amplitudes. */
  basis: "curve" | "envelope";
}

export interface SeriesStats {
  n: number;
  initial: number;
  final: number;
  min: number;
  minX: number;
  minIdx: number;
  max: number;
  maxX: number;
  maxIdx: number;
  range: number;
  /** x-weighted mean (area / span); arithmetic mean if span is 0. */
  mean: number;
  std: number;
  /** Trapezoidal area under the curve. */
  auc: number;
  net: number;
  /** net / |initial| (null when initial is 0). */
  netPct: number | null;
  peaks: number[];
  troughs: number[];
  zeroCrossings: number;
  shape: Shape;
  /** Mean spacing between successive peaks (or troughs), when oscillating. */
  period: number | null;
  fit: ExpFit | null;
  thresholds: Threshold[];
  /** True when the last 10% of the window still moves by more than 5% of the range. */
  stillChanging: boolean;
  x0: number;
  x1: number;
}

/* ------------------------------------------------------------------ helpers */

/** Pairs up x / y, dropping non-finite values. */
export function cleanXY(x: number[], y: (number | null | undefined)[]): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const yi = y[i];
    if (Number.isFinite(x[i]) && typeof yi === "number" && Number.isFinite(yi)) {
      xs.push(x[i]);
      ys.push(yi);
    }
  }
  return { x: xs, y: ys };
}

export function trapz(x: number[], y: number[]): number {
  let s = 0;
  for (let i = 1; i < Math.min(x.length, y.length); i++) s += ((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]);
  return s;
}

/** Linear interpolation of y at xq (clamped to the ends). */
export function interpAt(x: number[], y: number[], xq: number): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return NaN;
  if (xq <= x[0]) return y[0];
  if (xq >= x[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xq) lo = mid;
    else hi = mid;
  }
  const t = (xq - x[lo]) / (x[hi] - x[lo] || 1);
  return y[lo] + t * (y[hi] - y[lo]);
}

/** Index of the sample whose x is closest to xq (x must be sorted). */
export function nearestIndex(x: number[], xq: number): number {
  const n = x.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xq) lo = mid;
    else hi = mid;
  }
  return Math.abs(x[lo] - xq) <= Math.abs(x[hi] - xq) ? lo : hi;
}

/** First x (interpolated) after `start` where y crosses `level` going in `dir`. */
export function firstCrossing(
  x: number[],
  y: number[],
  level: number,
  dir: "below" | "above",
  start = 0,
): number | null {
  for (let i = Math.max(1, start + 1); i < y.length; i++) {
    const a = y[i - 1];
    const b = y[i];
    const hit = dir === "below" ? a > level && b <= level : a < level && b >= level;
    if (hit) {
      const t = (level - a) / (b - a || 1);
      return x[i - 1] + t * (x[i] - x[i - 1]);
    }
  }
  return null;
}

/** Interpolated x positions where y changes sign. */
export function signChanges(x: number[], y: number[]): number[] {
  const out: number[] = [];
  let prevI = -1;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === 0) continue;
    if (prevI >= 0 && Math.sign(y[i]) !== Math.sign(y[prevI])) {
      const a = y[prevI];
      const b = y[i];
      const t = a / (a - b);
      out.push(x[prevI] + t * (x[i] - x[prevI]));
    }
    prevI = i;
  }
  return out;
}

interface LinFit {
  slope: number;
  intercept: number;
  r2: number;
}

function linFit(xs: number[], ys: number[]): LinFit | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** Pearson correlation (null for flat inputs). */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  if (saa === 0 || sbb === 0) return null;
  return sab / Math.sqrt(saa * sbb);
}

/** Local maxima / minima with hysteresis (ignores wiggles smaller than h). */
function extrema(y: number[], h: number): { peaks: number[]; troughs: number[] } {
  const peaks: number[] = [];
  const troughs: number[] = [];
  if (y.length < 3 || h <= 0) return { peaks, troughs };
  let mode: "up" | "down" | null = null;
  let ext = 0;
  for (let i = 1; i < y.length; i++) {
    if (mode === null) {
      if (y[i] - y[0] > h) {
        mode = "up";
        ext = i;
      } else if (y[0] - y[i] > h) {
        mode = "down";
        ext = i;
      }
    } else if (mode === "up") {
      if (y[i] >= y[ext]) ext = i;
      else if (y[ext] - y[i] > h) {
        peaks.push(ext);
        mode = "down";
        ext = i;
      }
    } else {
      if (y[i] <= y[ext]) ext = i;
      else if (y[i] - y[ext] > h) {
        troughs.push(ext);
        mode = "up";
        ext = i;
      }
    }
  }
  return { peaks, troughs };
}

function meanSpacing(x: number[], idx: number[]): number | null {
  if (idx.length < 2) return null;
  return (x[idx[idx.length - 1]] - x[idx[0]]) / (idx.length - 1);
}

/** Fit y ≈ c + A·e^{kx} by log-linear regression on |y − c| for a few candidate asymptotes. */
function fitExponential(x: number[], y: number[], range: number): ExpFit | null {
  const n = y.length;
  if (n < 8 || range <= 0) return null;
  const candidates: number[] = [];
  if (Math.min(...y) > 0 || Math.max(...y) < 0) candidates.push(0);
  // Three-point asymptote estimate at equally spaced x.
  const xm = (x[0] + x[n - 1]) / 2;
  const y1 = y[0];
  const y2 = interpAt(x, y, xm);
  const y3 = y[n - 1];
  const den = y1 + y3 - 2 * y2;
  if (Math.abs(den) > 1e-9 * range) {
    const c = (y1 * y3 - y2 * y2) / den;
    if (Number.isFinite(c)) candidates.push(c);
  }
  let best: ExpFit | null = null;
  for (const c of candidates) {
    const xs: number[] = [];
    const ls: number[] = [];
    const sign = Math.sign(y[0] - c);
    if (sign === 0) continue;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const g = (y[i] - c) * sign;
      if (g <= 1e-9 * range) {
        // Allow the tail to touch the asymptote, but not to cross it.
        if (g < -0.01 * range) ok = false;
        continue;
      }
      xs.push(x[i]);
      ls.push(Math.log(g));
    }
    if (!ok || xs.length < Math.max(8, n * 0.6)) continue;
    const f = linFit(xs, ls);
    if (!f || f.slope === 0 || !Number.isFinite(f.slope)) continue;
    if (!best || f.r2 > best.r2) {
      const k = f.slope;
      best = {
        kind: k < 0 ? "decay" : "growth",
        k,
        tau: 1 / Math.abs(k),
        half: Math.LN2 / Math.abs(k),
        c,
        r2: f.r2,
        basis: "curve",
      };
    }
  }
  return best && best.r2 >= 0.97 ? best : null;
}

/** Decay of oscillation amplitude around the final value. */
function fitEnvelope(x: number[], y: number[], idx: number[], center: number): ExpFit | null {
  const xs: number[] = [];
  const ls: number[] = [];
  for (const i of idx) {
    const amp = Math.abs(y[i] - center);
    if (amp > 0) {
      xs.push(x[i]);
      ls.push(Math.log(amp));
    }
  }
  const f = linFit(xs, ls);
  if (!f || f.slope >= 0 || f.r2 < 0.8) return null;
  const k = f.slope;
  return { kind: "decay", k, tau: 1 / -k, half: Math.LN2 / -k, c: center, r2: f.r2, basis: "envelope" };
}

/* ------------------------------------------------------------------ main */

export function computeSeriesStats(xIn: number[], yIn: (number | null | undefined)[]): SeriesStats | null {
  const { x, y } = cleanXY(xIn, yIn);
  const n = y.length;
  if (n === 0) return null;

  let minIdx = 0;
  let maxIdx = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (y[i] < y[minIdx]) minIdx = i;
    if (y[i] > y[maxIdx]) maxIdx = i;
    sum += y[i];
  }
  const min = y[minIdx];
  const max = y[maxIdx];
  const range = max - min;
  const initial = y[0];
  const final = y[n - 1];
  const x0 = x[0];
  const x1 = x[n - 1];
  const span = x1 - x0;
  const auc = trapz(x, y);
  const arithMean = sum / n;
  const mean = span > 0 ? auc / span : arithMean;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (y[i] - arithMean) ** 2;
  const std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const net = final - initial;
  const netPct = initial !== 0 ? net / Math.abs(initial) : null;

  const flat = range <= 1e-12 * (Math.abs(max) + 1);
  const { peaks, troughs } = flat ? { peaks: [], troughs: [] } : extrema(y, 0.02 * range);
  const zeroCrossings = min < 0 && max > 0 ? signChanges(x, y).length : 0;

  // Shape classification.
  let shape: Shape;
  if (flat) shape = "constant";
  else {
    const tol = 0.001 * range;
    let up = true;
    let down = true;
    for (let i = 1; i < n; i++) {
      const d = y[i] - y[i - 1];
      if (d < -tol) up = false;
      if (d > tol) down = false;
    }
    const ext = peaks.length + troughs.length;
    if (up) shape = "increasing";
    else if (down) shape = "decreasing";
    else if (ext >= 2) shape = "oscillating";
    else if (peaks.length === 1) shape = "peak";
    else if (troughs.length === 1) shape = "valley";
    else shape = "irregular";
  }

  const periodPk = meanSpacing(x, peaks);
  const periodTr = meanSpacing(x, troughs);
  const period =
    shape === "oscillating" && (periodPk !== null || periodTr !== null)
      ? periodPk !== null && periodTr !== null
        ? (periodPk * (peaks.length - 1) + periodTr * (troughs.length - 1)) /
          (peaks.length - 1 + troughs.length - 1)
        : (periodPk ?? periodTr)
      : null;

  let fit: ExpFit | null = null;
  if (shape === "increasing" || shape === "decreasing") fit = fitExponential(x, y, range);
  else if (shape === "oscillating") {
    const idx = [...peaks, ...troughs].sort((a, b) => a - b);
    if (idx.length >= 3) fit = fitEnvelope(x, y, idx, final);
  }

  // Still changing at the end of the window?
  const tailStart = Math.max(0, Math.floor(n * 0.9) - 1);
  let tailMin = Infinity;
  let tailMax = -Infinity;
  for (let i = tailStart; i < n; i++) {
    tailMin = Math.min(tailMin, y[i]);
    tailMax = Math.max(tailMax, y[i]);
  }
  const stillChanging = !flat && tailMax - tailMin > 0.05 * range;

  // Thresholds.
  const thresholds: Threshold[] = [];
  if (!flat && Math.abs(net) > 0.01 * range) {
    const dir = net < 0 ? "below" : "above";
    thresholds.push({
      id: "half",
      label: "Halfway point",
      hint: "Covers 50% of its change from start to end",
      x: firstCrossing(x, y, initial + 0.5 * net, dir),
    });
    thresholds.push({
      id: "ninety",
      label: "90% of the change",
      hint: "Typical “rise / fall time” marker",
      x: firstCrossing(x, y, initial + 0.9 * net, dir),
    });
  }
  if (!flat) {
    const band = 0.05 * range;
    let last = -1;
    for (let i = 0; i < n; i++) if (Math.abs(y[i] - final) > band) last = i;
    if (stillChanging) {
      thresholds.push({
        id: "settle",
        label: "Settles within ±5%",
        hint: "Stays within 5% of the range around its final value",
        x: null,
        never: "Still moving at the end of the window",
      });
    } else if (last >= 0 && last < n - 1) {
      thresholds.push({
        id: "settle",
        label: "Settles within ±5%",
        hint: "Stays within 5% of the range around its final value",
        x: x[last + 1],
      });
    }
  }
  if (!flat && maxIdx > 0 && maxIdx < n - 1 && max > 0) {
    thresholds.push({
      id: "peakhalf",
      label: "Falls to 50% of peak",
      hint: "After the maximum, first drop below half of it",
      x: firstCrossing(x, y, 0.5 * max, "below", maxIdx),
      never: "Never falls to half of its peak",
    });
  }
  if (!flat && initial > 0 && min <= 0.1 * initial) {
    thresholds.push({
      id: "tenth",
      label: "Below 10% of initial",
      hint: "First time under one tenth of the starting value",
      x: firstCrossing(x, y, 0.1 * initial, "below"),
    });
  }

  return {
    n,
    initial,
    final,
    min,
    minX: x[minIdx],
    minIdx,
    max,
    maxX: x[maxIdx],
    maxIdx,
    range,
    mean,
    std,
    auc,
    net,
    netPct,
    peaks,
    troughs,
    zeroCrossings,
    shape,
    period,
    fit,
    thresholds,
    stillChanging,
    x0,
    x1,
  };
}

/* ------------------------------------------------------------------ comparison */

export interface Comparison {
  x: number[];
  diff: number[];
  /** a/b; null where b is ~0. */
  ratio: (number | null)[];
  ratioValid: boolean;
  maxAbsDiff: number;
  maxAbsDiffX: number;
  maxAbsDiffIdx: number;
  meanDiff: number;
  /** ∫|a−b| dx */
  areaBetween: number;
  crossings: number[];
  initialGap: number;
  finalGap: number;
  /** final gap relative to |b_final| */
  finalGapPct: number | null;
  /** Fraction of the x-span where a > b. */
  aAboveFrac: number;
  r: number | null;
  finalA: number;
  finalB: number;
}

export function compareSeries(
  xIn: number[],
  aIn: (number | null | undefined)[],
  bIn: (number | null | undefined)[],
): Comparison | null {
  const n0 = Math.min(xIn.length, aIn.length, bIn.length);
  const x: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < n0; i++) {
    const ai = aIn[i];
    const bi = bIn[i];
    if (
      Number.isFinite(xIn[i]) &&
      typeof ai === "number" &&
      Number.isFinite(ai) &&
      typeof bi === "number" &&
      Number.isFinite(bi)
    ) {
      x.push(xIn[i]);
      a.push(ai);
      b.push(bi);
    }
  }
  const n = x.length;
  if (n < 2) return null;
  const diff = a.map((v, i) => v - b[i]);
  let maxIdx = 0;
  for (let i = 1; i < n; i++) if (Math.abs(diff[i]) > Math.abs(diff[maxIdx])) maxIdx = i;
  const span = x[n - 1] - x[0];
  const meanDiff = span > 0 ? trapz(x, diff) / span : diff.reduce((s, v) => s + v, 0) / n;
  const areaBetween = trapz(
    x,
    diff.map((v) => Math.abs(v)),
  );
  const bScale = Math.max(...b.map((v) => Math.abs(v)));
  let valid = 0;
  const ratio = a.map((v, i) => {
    if (Math.abs(b[i]) <= 1e-6 * (bScale || 1)) return null;
    const r = v / b[i];
    if (!Number.isFinite(r) || Math.abs(r) > 1e6) return null;
    valid++;
    return r;
  });
  let above = 0;
  for (let i = 1; i < n; i++) {
    const mid = (diff[i] + diff[i - 1]) / 2;
    if (mid > 0) above += x[i] - x[i - 1];
  }
  const finalGap = diff[n - 1];
  return {
    x,
    diff,
    ratio,
    ratioValid: valid >= n * 0.7,
    maxAbsDiff: Math.abs(diff[maxIdx]),
    maxAbsDiffX: x[maxIdx],
    maxAbsDiffIdx: maxIdx,
    meanDiff,
    areaBetween,
    crossings: signChanges(x, diff),
    initialGap: diff[0],
    finalGap,
    finalGapPct: b[n - 1] !== 0 ? finalGap / Math.abs(b[n - 1]) : null,
    aAboveFrac: span > 0 ? above / span : diff[0] > 0 ? 1 : 0,
    r: pearson(a, b),
    finalA: a[n - 1],
    finalB: b[n - 1],
  };
}

/** ~`target` evenly spaced indices plus any `extra` indices (extremes), sorted & unique. */
export function sampleIndices(n: number, target: number, extra: number[] = []): number[] {
  if (n <= 0) return [];
  const set = new Set<number>();
  if (n <= target) for (let i = 0; i < n; i++) set.add(i);
  else for (let k = 0; k < target; k++) set.add(Math.round((k * (n - 1)) / (target - 1)));
  for (const e of extra) if (e >= 0 && e < n) set.add(e);
  return [...set].sort((p, q) => p - q);
}
