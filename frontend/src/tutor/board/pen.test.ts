import { describe, expect, it } from "vitest";
import { latexChars, lineMs, schedule, writeKeyframes, writeMs, PEN_LIFT_MS } from "./pen";

describe("pen timing", () => {
  it("writes one line slowly enough to follow: 2–3 s", () => {
    expect(lineMs(1)).toBe(2000);
    expect(lineMs(20)).toBe(2400);
    expect(lineMs(200)).toBe(3000);
  });

  it("multi-line writing takes a line's time per line", () => {
    expect(writeMs(60, 3)).toBe(3 * lineMs(20));
  });

  it("counts visible LaTeX glyphs, not markup", () => {
    expect(latexChars("\\frac{a}{b}")).toBe(3);
    expect(latexChars("x^2 + y^2")).toBe(5);
  });

  it("queues writes on one pen: the second starts when the first ends", () => {
    const a = schedule(1000, 0, 800);
    expect(a).toEqual({ delay: 0, freeAt: 1800 + PEN_LIFT_MS });
    const b = schedule(1100, a.freeAt, 600);
    expect(b.delay).toBe(a.freeAt - 1100);
    // an idle pen starts at once
    expect(schedule(5000, a.freeAt, 600).delay).toBe(0);
  });
});

describe("writeKeyframes", () => {
  it("starts hidden and ends fully revealed", () => {
    const { clip } = writeKeyframes(1);
    expect(clip.startsWith("0% { clip-path: polygon(-5% -30%, 105% -30%, 105% -30%, -5% -30%, -5% 130%, -5% 130%)")).toBe(true);
    expect(clip).toContain("100% { clip-path: polygon(-5% -30%, 105% -30%, 105% -30%, 105% -30%, 105% 130%, -5% 130%)");
  });

  it("reveals rows in order, one row per equal slice of time", () => {
    const { clip, tip } = writeKeyframes(3);
    expect(clip.match(/clip-path/g)).toHaveLength(6);
    expect(clip).toContain("33.333% { clip-path: polygon(-5% -30%, 105% -30%, 105% -30%, 105% -30%, 105% 33.333%");
    expect(clip).toContain("33.334% { clip-path: polygon(-5% -30%, 105% -30%, 105% 33.333%, -5% 33.333%, -5% 66.667%");
    expect(tip).toContain("top: 50%");
    expect(tip.endsWith("100% { left: 100%; opacity: 0 }")).toBe(true);
  });
});
