import { describe, expect, it } from "vitest";
import valid from "../contracts/examples/valid_ops.json";
import invalid from "../contracts/examples/invalid_ops.json";
import { validateOp } from "./ops";

// Every id any valid example references, so reference checks pass.
const seeded = new Set(["title", "eq_update", "eq_theta", "plot_damped", "plot_points", "box_beta", "line_sep", "arr1", "img_ball"]);

describe("validateOp", () => {
  it("validates every example", () => {
    for (const op of valid.ops) {
      const r = validateOp(op, seeded);
      expect(r, JSON.stringify(op)).toHaveProperty("op");
    }
    for (const c of invalid.cases) {
      const r = validateOp(c.op, seeded);
      expect(r, c.why).toHaveProperty("error");
    }
  });

  it("rejects_unknown_target", () => {
    const r = validateOp({ op: "highlight", target_id: "nope" }, seeded);
    expect("error" in r && r.error).toContain("nope");
  });

  it("rejects unknown ids in arrows and relative places", () => {
    expect(validateOp({ op: "draw_arrow", from_id: "title", to_id: "ghost" }, seeded)).toHaveProperty("error");
    expect(validateOp({ op: "write_text", text: "x", place: "below:ghost" }, seeded)).toHaveProperty("error");
    expect(validateOp({ op: "write_text", text: "x", place: "right_of:title" }, seeded)).toHaveProperty("op");
  });

  it("rejects non-objects without throwing", () => {
    expect(validateOp(null, seeded)).toHaveProperty("error");
    expect(validateOp("write_text", seeded)).toHaveProperty("error");
  });

  describe("student items are read-only", () => {
    const ids = new Set([...seeded, "ink1"]);
    const student = new Set(["ink1"]);

    it("rejects a drawable op that reuses a student id", () => {
      for (const op of [
        { op: "write_text", id: "ink1", text: "x", place: "next" },
        { op: "write_math", id: "ink1", latex: "x", place: "next" },
        { op: "draw_shape", id: "ink1", shape: "rect", place: "next" },
        { op: "plot_function", id: "ink1", expr: "x", x_range: [0, 1], place: "next" },
        { op: "place_image", id: "ink1", url: "https://a.b/c.png", place: "next" },
        { op: "draw_arrow", id: "ink1", from_id: "title", to_id: "eq_update" },
      ]) {
        const r = validateOp(op, ids, student);
        expect("error" in r && r.error, op.op).toContain('id "ink1" belongs to the student');
      }
    });

    it("rejects erasing a student item", () => {
      const r = validateOp({ op: "erase", target_id: "ink1" }, ids, student);
      expect("error" in r && r.error).toContain('id "ink1" belongs to the student');
    });

    it("still lets the tutor point at student work", () => {
      expect(validateOp({ op: "highlight", target_id: "ink1" }, ids, student)).toHaveProperty("op");
      expect(validateOp({ op: "draw_arrow", from_id: "title", to_id: "ink1" }, ids, student)).toHaveProperty("op");
      expect(validateOp({ op: "write_text", text: "see", place: "below:ink1" }, ids, student)).toHaveProperty("op");
      expect(validateOp({ op: "erase", target_id: "title" }, ids, student)).toHaveProperty("op");
    });
  });
});
