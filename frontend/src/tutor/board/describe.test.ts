import { describe, expect, it } from "vitest";
import type { TLShape } from "tldraw";
import { describeShapes } from "./describe";
import { toRichText } from "./toShapes";

const shape = (id: string, type: string, meta: object, props: object = {}) =>
  ({ id: `shape:${id}`, type, meta, props, opacity: 1 }) as unknown as TLShape;
const bboxes: Record<string, { x: number; y: number; w: number; h: number }> = {
  "shape:ink1": { x: 10, y: 10, w: 50, h: 40 },
  "shape:t": { x: 100, y: 100, w: 300, h: 40 },
  "shape:img": { x: 500, y: 100, w: 320, h: 240 },
  "shape:img__caption": { x: 500, y: 344, w: 320, h: 30 },
  "shape:img__highlight": { x: 0, y: 0, w: 1000, h: 1000 },
};
const toBoard = (s: TLShape) => bboxes[s.id];

describe("describeShapes", () => {
  it("describe marks user ink", () => {
    const { items } = describeShapes([shape("ink1", "draw", { author: "user" })], toBoard);
    expect(items).toEqual([{ id: "ink1", type: "ink", author: "user", bbox: bboxes["shape:ink1"] }]);
  });

  it("describe truncates long text", () => {
    const long = "a".repeat(500);
    const { items } = describeShapes([shape("t", "text", { author: "tutor", boardId: "t", kind: "text" }, { richText: toRichText(long) })], toBoard);
    expect(items[0].text!.length).toBeLessThanOrEqual(120);
    expect(items[0]).toMatchObject({ id: "t", type: "text", author: "tutor" });
  });

  it("merges an item's parts and ignores highlight overlays", () => {
    const meta = { author: "tutor", boardId: "img", kind: "image" };
    const { items } = describeShapes([
      shape("img", "image", meta, { altText: "Ball" }),
      shape("img__caption", "text", { ...meta, part: "caption" }, { richText: toRichText("Ball rolling") }),
      shape("img__highlight", "geo", { author: "tutor", boardId: "img", kind: "highlight", part: "highlight" }),
    ], toBoard);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "img", type: "image", label: "Ball rolling", bbox: { x: 500, y: 100, w: 320, h: 274 } });
  });

  it("reports latex for math", () => {
    bboxes["shape:m"] = { x: 0, y: 0, w: 10, h: 10 };
    const { items } = describeShapes([shape("m", "math", { author: "tutor", boardId: "m", kind: "math" }, { latex: "x^2" })], toBoard);
    expect(items[0]).toMatchObject({ type: "math", latex: "x^2" });
  });
});
