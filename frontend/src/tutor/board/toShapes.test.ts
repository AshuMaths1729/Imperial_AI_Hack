import { describe, expect, it } from "vitest";
import type { TLShape } from "tldraw";
import valid from "../contracts/examples/valid_ops.json";
import type { BoardOp } from "../contracts/types";
import { opToShapePartials } from "./toShapes";

const box = { x: 100, y: 200, w: 300, h: 80 };

describe("opToShapePartials", () => {
  it("math op maps to math shape with latex prop", () => {
    const [s] = opToShapePartials({ op: "write_math", id: "eq", latex: "e^{i\\pi}", place: "next" }, box, 1);
    expect(s.type).toBe("math");
    expect(s.id).toBe("shape:eq");
    expect(s.props).toMatchObject({ latex: "e^{i\\pi}", w: 300, h: 80 });
    expect({ x: s.x, y: s.y }).toEqual({ x: 100, y: 200 });
  });

  it("scales board units to page units", () => {
    const [s] = opToShapePartials({ op: "write_math", id: "eq", latex: "x", place: "next" }, box, 2);
    expect({ x: s.x, y: s.y, w: (s.props as { w: number }).w }).toEqual({ x: 200, y: 400, w: 600 });
  });

  it("stepped shapes start hidden", () => {
    const [s] = opToShapePartials({ op: "write_text", id: "a", text: "hi", place: "next", group: "g", step: 2 }, box, 1);
    expect(s.opacity).toBe(0);
    expect(s.meta).toMatchObject({ group: "g", step: 2 });
  });

  it("reveal_step hides later steps", () => {
    const shapes = [1, 2, 3].map((step) => ({
      id: `shape:s${step}`, type: "text", opacity: 0, meta: { author: "tutor", boardId: `s${step}`, group: "g", step },
    })) as unknown as TLShape[];
    const other = { id: "shape:o", type: "text", opacity: 1, meta: { author: "tutor", boardId: "o" } } as unknown as TLShape;
    const out = opToShapePartials({ op: "reveal_step", group_id: "g", step: 2 }, box, 1, [...shapes, other]);
    expect(out.map((p) => p.opacity)).toEqual([1, 1, 0]);
  });

  it("every shape carries author tutor", () => {
    const drawable = (valid.ops as BoardOp[]).filter((o) => "place" in o || o.op === "draw_arrow");
    for (const op of drawable) {
      const out = opToShapePartials(op, box, 1);
      expect(out.length, op.op).toBeGreaterThan(0);
      for (const s of out) expect(s.meta, op.op).toMatchObject({ author: "tutor", boardId: op.id });
    }
  });

  it("generates an id when the op has none", () => {
    const [s] = opToShapePartials({ op: "write_text", text: "hi", place: "next" }, box, 1);
    expect(s.meta?.boardId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
