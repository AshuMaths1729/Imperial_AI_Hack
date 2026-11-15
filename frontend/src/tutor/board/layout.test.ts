import { describe, expect, it } from "vitest";
import type { Box } from "../contracts/types";
import { BOARD_H, BOARD_W, contentRegion, resolvePlace } from "./layout";

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box) => b.x >= 20 && b.y >= 20 && b.x + b.w <= 980 && b.y + b.h <= 2980;

describe("resolvePlace", () => {
  it("the page is 1000 wide and 3000 tall", () => {
    expect([BOARD_W, BOARD_H]).toEqual([1000, 3000]);
  });

  it("next stacks down the page, left-aligned, without overlap", () => {
    const occupied = new Map<string, Box>();
    for (let i = 0; i < 12; i++) occupied.set(`b${i}`, resolvePlace("next", { w: 300, h: 150 }, occupied));
    const boxes = [...occupied.values()];
    boxes.forEach((b) => expect(inside(b), JSON.stringify(b)).toBe(true));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    expect(boxes[0]).toEqual({ x: 20, y: 20, w: 300, h: 150 });
    expect(boxes[1]).toEqual({ x: 20, y: 190, w: 300, h: 150 });
    boxes.forEach((b) => expect(b.x).toBe(20));
  });

  it("a 5-line stepped derivation stacks under the previous line of its group", () => {
    const occupied = new Map<string, Box>([["question", { x: 20, y: 20, w: 600, h: 80 }]]);
    let prev: Box | undefined;
    const lines: Box[] = [];
    for (let i = 0; i < 5; i++) {
      prev = resolvePlace("next", { w: 200 + i * 40, h: 60 }, occupied, prev);
      occupied.set(`l${i}`, prev);
      lines.push(prev);
    }
    lines.forEach((b, i) => {
      expect(b.x).toBe(20);
      if (i) expect(b.y).toBe(lines[i - 1].y + 60 + 20);
    });
    expect(lines[0].y).toBe(120);
  });

  it("group next keeps the group's x even after other items were placed below", () => {
    const occupied = new Map<string, Box>([
      ["g1", { x: 100, y: 20, w: 300, h: 60 }],
      ["other", { x: 100, y: 100, w: 300, h: 60 }],
    ]);
    const r = resolvePlace("next", { w: 300, h: 60 }, occupied, occupied.get("g1"));
    expect(r).toEqual({ x: 100, y: 180, w: 300, h: 60 });
  });

  it("below and right_of place relative", () => {
    const a = { x: 100, y: 100, w: 200, h: 80 };
    const occupied = new Map([["a", a]]);
    expect(resolvePlace("below:a", { w: 150, h: 50 }, occupied)).toEqual({ x: 100, y: 200, w: 150, h: 50 });
    expect(resolvePlace("right_of:a", { w: 150, h: 50 }, occupied)).toEqual({ x: 320, y: 100, w: 150, h: 50 });
  });

  it("below works far down the page", () => {
    const a = { x: 20, y: 1500, w: 200, h: 80 };
    expect(resolvePlace("below:a", { w: 150, h: 50 }, new Map([["a", a]]))).toEqual({ x: 20, y: 1600, w: 150, h: 50 });
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
    const r = resolvePlace("region:600,2700,250,120", { w: 200, h: 200 }, new Map());
    expect(r.w).toBeLessThanOrEqual(250);
    expect(r.h).toBeLessThanOrEqual(120);
    expect(r.w / r.h).toBeCloseTo(1);
    expect(r.x).toBeGreaterThanOrEqual(600);
    expect(r.y).toBeGreaterThanOrEqual(2700);
  });
});

describe("contentRegion (default snapshot)", () => {
  it("is the top square of an empty or short page", () => {
    expect(contentRegion([])).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    expect(contentRegion([{ bbox: { x: 20, y: 20, w: 100, h: 100 } }])).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });

  it("reaches below items far down the 3000-tall page, but not past it", () => {
    expect(contentRegion([{ bbox: { x: 20, y: 1800, w: 300, h: 60 } }])).toEqual({ x: 0, y: 0, w: 1000, h: 1900 });
    expect(contentRegion([{ bbox: { x: 20, y: 2950, w: 300, h: 40 } }]).h).toBe(3000);
  });
});
