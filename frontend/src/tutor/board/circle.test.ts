import { describe, expect, it } from "vitest";
import type { BoardItem } from "../contracts/types";
import { downscaleDims, itemsInRegion, lassoRegion } from "./circle";

const item = (id: string, x: number, y: number, w: number, h: number): BoardItem => ({ id, type: "text", author: "tutor", bbox: { x, y, w, h } });

describe("circle helpers", () => {
  it("itemsInRegion uses 50% rule", () => {
    const region = { x: 0, y: 0, w: 100, h: 100 };
    const items = [
      item("all", 10, 10, 20, 20), // fully inside
      item("half", 50, 0, 100, 50), // exactly 50% inside
      item("little", 90, 0, 100, 50), // 10% inside
      item("out", 200, 200, 10, 10),
    ];
    expect(itemsInRegion(items, region)).toEqual(["all", "half"]);
  });

  it("counts a flat item by its centre", () => {
    expect(itemsInRegion([item("line", 10, 50, 50, 0)], { x: 0, y: 0, w: 100, h: 100 })).toEqual(["line"]);
  });

  it("empty region yields no items", () => {
    expect(itemsInRegion([item("a", 500, 500, 100, 100)], { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
    expect(itemsInRegion([], { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });

  it("downscales large crops", () => {
    expect(downscaleDims(4000, 1000)).toEqual({ w: 1024, h: 256 });
    expect(downscaleDims(500, 300)).toEqual({ w: 500, h: 300 });
    expect(downscaleDims(1000, 3000, 300)).toEqual({ w: 100, h: 300 });
  });
});

describe("lassoRegion", () => {
  it("clips to the board and grows tiny lassos", () => {
    expect(lassoRegion({ x: -50, y: 900, w: 200, h: 300 })).toEqual({ x: 0, y: 900, w: 150, h: 100 });
    expect(lassoRegion({ x: 500, y: 500, w: 0, h: 0 })).toEqual({ x: 484, y: 484, w: 32, h: 32 });
    expect(lassoRegion({ x: 995, y: 0, w: 2, h: 2 })).toEqual({ x: 968, y: 0, w: 32, h: 32 });
  });
});
