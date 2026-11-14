import type { Box } from "../contracts/types";
import { BOARD_H, BOARD_W } from "./layout";

export type Mark = "circle" | "underline" | "cross" | "tick";
type Pt = { x: number; y: number };

// Deterministic wobble seeded by the box, so a redraw of the same mark looks the same.
const wobble = (b: Box) => {
  let s = Math.abs(Math.round(b.x * 7 + b.y * 13 + b.w * 3 + b.h)) % 233280 || 1;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 2 - 1;
};
const onPage = (p: Pt): Pt => ({ x: Math.max(0, Math.min(BOARD_W, p.x)), y: Math.max(0, Math.min(BOARD_H, p.y)) });
const line = (a: Pt, b: Pt, n: number, bend = 0): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + bend * Math.sin(Math.PI * t) };
  });

/** Hand-drawn strokes (board units, one array per pen stroke) marking `b`. */
export function annotateStrokes(mark: Mark, b: Box): Pt[][] {
  const r = wobble(b);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let strokes: Pt[][];
  switch (mark) {
    case "circle": {
      // A loop that starts top-left, goes round once and overshoots, with the radius drifting outward. It is a
      // squarish ellipse (superellipse, P=3) padded mostly sideways: stacked lines of working leave little room
      // above and below. Grown until the box corners sit at 0.95 of its radius, so the wobble never cuts the item.
      const P = 3, a = b.w / 2, c = b.h / 2, rx0 = a * 1.15 + 14, ry0 = c + 8;
      const s = Math.max(1, ((a / rx0) ** P + (c / ry0) ** P) ** (1 / P) / 0.95), rx = rx0 * s, ry = ry0 * s;
      const n = 64, start = -2.2 + r() * 0.2, sweep = Math.PI * 2 + 0.35, phase = r() * Math.PI;
      const pow = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / P);
      strokes = [Array.from({ length: n + 1 }, (_, i) => {
        const t = i / n, th = start + sweep * t;
        const k = 1 + 0.025 * Math.sin(3 * th + phase) + 0.04 * t;
        return { x: cx + pow(Math.cos(th)) * rx * k, y: cy + pow(Math.sin(th)) * ry * k };
      })];
      break;
    }
    case "underline":
      strokes = [line({ x: b.x - 6, y: b.y + b.h + 8 + r() * 2 }, { x: b.x + b.w + 6, y: b.y + b.h + 10 + r() * 2 }, 16, 3)];
      break;
    case "cross":
      strokes = [
        line({ x: b.x + r() * 4, y: b.y + r() * 4 }, { x: b.x + b.w, y: b.y + b.h }, 10, 2),
        line({ x: b.x + b.w + r() * 4, y: b.y }, { x: b.x, y: b.y + b.h + r() * 4 }, 10, -2),
      ];
      break;
    case "tick": {
      const s = Math.max(30, Math.min(60, b.h)), x0 = b.x + b.w + 14, y0 = cy - s * 0.1;
      const low = { x: x0 + s * 0.35, y: y0 + s * 0.4 };
      strokes = [[...line({ x: x0, y: y0 }, low, 5), ...line(low, { x: x0 + s, y: y0 - s * 0.6 }, 10, 2).slice(1)]];
      break;
    }
  }
  return strokes.map((st) => st.map(onPage));
}
