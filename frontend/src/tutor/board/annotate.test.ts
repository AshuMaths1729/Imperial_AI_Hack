import { describe, expect, it } from "vitest";
import { annotateStrokes } from "./annotate";

const box = { x: 100, y: 500, w: 400, h: 60 };
const all = (s: { x: number; y: number }[][]) => s.flat();
const bounds = (pts: { x: number; y: number }[]) => ({
  x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
  y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)),
});

describe("annotateStrokes", () => {
  it("circle: one closed-ish loop around the item that never cuts through it", () => {
    const s = annotateStrokes("circle", box);
    expect(s).toHaveLength(1);
    const b = bounds(s[0]);
    expect(b.x0).toBeLessThan(box.x);
    expect(b.x1).toBeGreaterThan(box.x + box.w);
    expect(b.y0).toBeLessThan(box.y);
    expect(b.y1).toBeGreaterThan(box.y + box.h);
    for (const p of s[0]) {
      const inside = p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;
      expect(inside, JSON.stringify(p)).toBe(false);
    }
    // overshoots its start a little, like a hand-drawn loop
    const first = s[0][0], last = s[0][s[0].length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(box.w / 2);
  });

  it("circle looks hand-drawn, not a perfect ellipse", () => {
    const [loop] = annotateStrokes("circle", box);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const norm = loop.map((p) => Math.hypot((p.x - cx) / (box.w / 2), (p.y - cy) / (box.h / 2)));
    expect(Math.max(...norm) - Math.min(...norm)).toBeGreaterThan(0.02);
  });

  it("underline: under the item, spanning its width", () => {
    const [line, ...rest] = annotateStrokes("underline", box);
    expect(rest).toHaveLength(0);
    const b = bounds(line);
    expect(b.y0).toBeGreaterThan(box.y + box.h);
    expect(b.y1).toBeLessThan(box.y + box.h + 30);
    expect(b.x0).toBeLessThanOrEqual(box.x);
    expect(b.x1).toBeGreaterThanOrEqual(box.x + box.w);
  });

  it("cross: two strokes corner to corner", () => {
    const s = annotateStrokes("cross", box);
    expect(s).toHaveLength(2);
    const b = bounds(all(s));
    expect(b.x0).toBeLessThanOrEqual(box.x + 5);
    expect(b.x1).toBeGreaterThanOrEqual(box.x + box.w - 5);
    expect(s[0][0].y).toBeLessThan(s[0][s[0].length - 1].y);
    expect(s[1][0].y).toBeLessThan(s[1][s[1].length - 1].y);
    expect(s[0][0].x).toBeLessThan(s[1][0].x);
  });

  it("tick: one stroke just right of the item, dipping then rising", () => {
    const [t, ...rest] = annotateStrokes("tick", box);
    expect(rest).toHaveLength(0);
    const b = bounds(t);
    expect(b.x0).toBeGreaterThan(box.x + box.w);
    const low = t.reduce((m, p) => (p.y > m.y ? p : m));
    expect(low.y).toBeGreaterThan(t[0].y);
    expect(t[t.length - 1].y).toBeLessThan(t[0].y);
  });

  it("stays on the page", () => {
    for (const mark of ["circle", "underline", "cross", "tick"] as const) {
      const b = bounds(all(annotateStrokes(mark, { x: 0, y: 0, w: 1000, h: 40 })));
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(1000);
    }
  });

  it("is deterministic for the same box", () => {
    expect(annotateStrokes("circle", box)).toEqual(annotateStrokes("circle", box));
  });
});
