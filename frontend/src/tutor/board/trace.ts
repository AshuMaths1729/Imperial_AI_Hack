// Pure geometry for the laser: the path it travels along a pointed item (page units).
import type { Box } from "../contracts/types";

export type Pt = { x: number; y: number };
/** Strokes travelled in order; the laser jumps (no travel time) from one stroke's end to the next one's start. */
export type Path = Pt[][];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const strokeLength = (s: Pt[]) => s.reduce((d, p, i) => d + (i ? dist(s[i - 1], p) : 0), 0);

/** A written line, row by row, left → right; `at` is the height within each row (0.9 ≈ underlining it). */
export function linePath(b: Box, rows = 1, at = 0.9): Path {
  const h = b.h / rows;
  return Array.from({ length: rows }, (_, i) => {
    const y = b.y + h * (i + at);
    return [{ x: b.x, y }, { x: b.x + b.w, y }];
  });
}

type Plot = { x: number; y: number; w: number; h: number; xMin: number; xMax: number; label: string; expr: string; points: number[][] };

/**
 * A plot's curve (or data line), left → right, in page units: the same scales function-plot draws with
 * (cartesian margins left 40, right 20, top 20 — 40 with a title — bottom 20). Breaks where the function is undefined.
 */
export function plotPath(p: Plot, [yLo, yHi]: [number, number], f?: (x: number) => number, n = 60): Path {
  const top = p.label ? 40 : 20, left = 40;
  const iw = p.w - left - 20, ih = p.h - top - 20;
  const at = (x: number, y: number): Pt => ({ x: p.x + left + ((x - p.xMin) / (p.xMax - p.xMin)) * iw, y: p.y + top + (1 - (y - yLo) / (yHi - yLo)) * ih });
  const data = p.expr && f
    ? Array.from({ length: n + 1 }, (_, i) => { const x = p.xMin + ((p.xMax - p.xMin) * i) / n; return [x, f(x)]; })
    : p.points;
  const out: Path = [[]];
  for (const [x, y] of data) {
    if (Number.isFinite(y)) out[out.length - 1].push(at(x, y));
    else if (out[out.length - 1].length) out.push([]);
  }
  return out.filter((s) => s.length);
}

/** Length the laser travels (jumps between strokes are free). */
export const pathLength = (path: Path) => path.reduce((d, s) => d + strokeLength(s), 0);

/** Travel time: about the pace of reading a line aloud, 1–1.5 s. */
export const travelMs = (length: number) => clamp(Math.round(length * 2.5), 1000, 1500);

/** The point a fraction `t` (0–1) of the travelled length along the path. */
export function along(path: Path, t: number): Pt {
  let left = clamp(t, 0, 1) * pathLength(path);
  for (const s of path) {
    for (let i = 1; i < s.length; i++) {
      const d = dist(s[i - 1], s[i]);
      if (left <= d && d > 0) {
        const k = left / d;
        return { x: s[i - 1].x + (s[i].x - s[i - 1].x) * k, y: s[i - 1].y + (s[i].y - s[i - 1].y) * k };
      }
      left -= d;
    }
  }
  const last = path[path.length - 1];
  return last[last.length - 1];
}
