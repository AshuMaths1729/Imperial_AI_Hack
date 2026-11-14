import { describe, expect, it } from "vitest";
import type { BoardHandle, Box } from "../contracts/types";
import { makeBoardRpcHandlers } from "./rpc";

function fakeBoard() {
  const calls: { applied: unknown[][]; regions: (Box | undefined)[] } = { applied: [], regions: [] };
  const board: BoardHandle = {
    applyOps: (ops) => { calls.applied.push(ops); return { ok: true, ids: ["a"], errors: [] }; },
    describe: () => ({ items: [{ id: "a", type: "text", author: "tutor", text: "hi", bbox: { x: 0, y: 0, w: 10, h: 10 } }] }),
    snapshot: async (region) => { calls.regions.push(region); return "PNG"; },
    setCircleMode: () => {},
  };
  return { board, calls };
}

describe("makeBoardRpcHandlers", () => {
  it("apply forwards ops and returns result", async () => {
    const { board, calls } = fakeBoard();
    const h = makeBoardRpcHandlers(() => board);
    const reply = JSON.parse(await h["board.apply"](JSON.stringify({ ops: [{ op: "clear_tutor_layer" }] })));
    expect(calls.applied).toEqual([[{ op: "clear_tutor_layer" }]]);
    expect(reply).toEqual({ ok: true, ids: ["a"], errors: [] });
  });

  it("describe and snapshot reply per contract", async () => {
    const { board, calls } = fakeBoard();
    const h = makeBoardRpcHandlers(() => board);
    expect(JSON.parse(await h["board.describe"]("{}")).items[0].id).toBe("a");
    const region = { x: 1, y: 2, w: 3, h: 4 };
    expect(JSON.parse(await h["board.snapshot"](JSON.stringify({ region })))).toEqual({ png_b64: "PNG" });
    expect(JSON.parse(await h["board.snapshot"]("{}"))).toEqual({ png_b64: "PNG" });
    expect(calls.regions).toEqual([region, undefined]);
  });

  it("malformed payload returns error json", async () => {
    const h = makeBoardRpcHandlers(() => fakeBoard().board);
    for (const bad of ["not json", "null", JSON.stringify({ ops: "x" }), JSON.stringify({})]) {
      const reply = JSON.parse(await h["board.apply"](bad));
      expect(reply.ok, bad).toBe(false);
      expect(reply.errors.length, bad).toBeGreaterThan(0);
    }
    expect(JSON.parse(await h["board.snapshot"]("{{")).ok).toBe(false);
    expect(JSON.parse(await h["board.snapshot"](JSON.stringify({ region: { x: "a", y: 0, w: 1, h: 1 } }))).ok).toBe(false);
    expect(JSON.parse(await h["board.snapshot"](JSON.stringify({ region: { x: 0, y: 0, w: 0, h: 10 } }))).ok).toBe(false);
  });

  it("null board returns error json", async () => {
    const h = makeBoardRpcHandlers(() => null);
    for (const m of ["board.apply", "board.describe", "board.snapshot"] as const) {
      const reply = JSON.parse(await h[m](JSON.stringify({ ops: [] })));
      expect(reply, m).toMatchObject({ ok: false });
      expect(reply.errors[0], m).toMatch(/board/i);
    }
  });

  it("a throwing board still yields error json", async () => {
    const { board } = fakeBoard();
    board.snapshot = async () => { throw new Error("export failed"); };
    const reply = JSON.parse(await makeBoardRpcHandlers(() => board)["board.snapshot"]("{}"));
    expect(reply).toEqual({ ok: false, ids: [], errors: ["export failed"] });
  });
});
