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
});
