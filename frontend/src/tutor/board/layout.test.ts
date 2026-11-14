import { describe, expect, it } from "vitest";
import type { Box } from "../contracts/types";
import { resolvePlace } from "./layout";

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box) => b.x >= 20 && b.y >= 20 && b.x + b.w <= 980 && b.y + b.h <= 980;

describe("resolvePlace", () => {
  it("next fills rows without overlap", () => {
    const occupied = new Map<string, Box>();
    for (let i = 0; i < 12; i++) occupied.set(`b${i}`, resolvePlace("next", { w: 300, h: 150 }, occupied));
    const boxes = [...occupied.values()];
    boxes.forEach((b) => expect(inside(b), JSON.stringify(b)).toBe(true));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    // rows top-to-bottom, left-to-right
    expect(boxes[0]).toEqual({ x: 20, y: 20, w: 300, h: 150 });
    expect(boxes[1].y).toBe(20);
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  });

  it("below and right_of place relative", () => {
    const a = { x: 100, y: 100, w: 200, h: 80 };
    const occupied = new Map([["a", a]]);
    expect(resolvePlace("below:a", { w: 150, h: 50 }, occupied)).toEqual({ x: 100, y: 200, w: 150, h: 50 });
    expect(resolvePlace("right_of:a", { w: 150, h: 50 }, occupied)).toEqual({ x: 320, y: 100, w: 150, h: 50 });
  });

  it("falls back to next when off-board", () => {
    const occupied = new Map([["a", { x: 900, y: 100, w: 60, h: 60 }]]);
    const r = resolvePlace("right_of:a", { w: 200, h: 100 }, occupied);
    expect(inside(r)).toBe(true);
    expect(overlaps(r, occupied.get("a")!)).toBe(false);
  });

  it("falls back to next when the spot is taken", () => {
    const a = { x: 20, y: 20, w: 200, h: 100 };
    const occupied = new Map([["a", a], ["b", { x: 20, y: 140, w: 200, h: 100 }]]);
    const r = resolvePlace("below:a", { w: 200, h: 100 }, occupied);
    for (const o of occupied.values()) expect(overlaps(r, o)).toBe(false);
  });

  it("region fits the size inside the box", () => {
    const r = resolvePlace("region:600,700,250,120", { w: 200, h: 200 }, new Map());
    expect(r.w).toBeLessThanOrEqual(250);
    expect(r.h).toBeLessThanOrEqual(120);
    expect(r.w / r.h).toBeCloseTo(1);
    expect(r.x).toBeGreaterThanOrEqual(600);
    expect(r.y).toBeGreaterThanOrEqual(700);
  });
});
