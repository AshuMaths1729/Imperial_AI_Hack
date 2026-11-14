import { describe, expect, it } from "vitest";
import type { BoardHandle, Box } from "../contracts/types";
import type { BoardItem } from "../contracts/types";
import { fitDescription, fitSnapshot, makeBoardRpcHandlers, RPC_REPLY_LIMIT } from "./rpc";

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
    const h = makeBoardRpcHandlers(() => board, async (png, side) => `${png}@${side}`);
    expect(JSON.parse(await h["board.describe"]("{}")).items[0].id).toBe("a");
    const region = { x: 1, y: 2, w: 3, h: 4 };
    expect(JSON.parse(await h["board.snapshot"](JSON.stringify({ region })))).toEqual({ png_b64: "PNG@768", mime: "image/jpeg" });
    expect(JSON.parse(await h["board.snapshot"]("{}"))).toEqual({ png_b64: "PNG@768", mime: "image/jpeg" });
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

  it("snapshot reply stays under the RPC limit", async () => {
    const { board } = fakeBoard();
    // ~40 bytes per px of long side: 768 → 30 KB, 512 → 20 KB, 384 → 15 KB, 256 → 10 KB
    const h = makeBoardRpcHandlers(() => board, async (_png, side) => "A".repeat(side * 40));
    const reply = await h["board.snapshot"]("{}");
    expect(new TextEncoder().encode(reply).length).toBeLessThanOrEqual(14000);
    expect(JSON.parse(reply).png_b64).toHaveLength(256 * 40);
  });
});

describe("fitSnapshot", () => {
  it("fits on first try", async () => {
    const sides: number[] = [];
    const r = await fitSnapshot("PNG", async (_p, side) => { sides.push(side); return "small"; });
    expect(r).toEqual({ png_b64: "small", mime: "image/jpeg" });
    expect(sides).toEqual([768]);
  });

  it("downscales until it fits", async () => {
    const sides: number[] = [];
    const r = await fitSnapshot("PNG", async (_p, side) => { sides.push(side); return "A".repeat(side * 30); });
    expect(sides).toEqual([768, 512, 384]);
    expect(r).toEqual({ png_b64: "A".repeat(384 * 30), mime: "image/jpeg" });
    expect(RPC_REPLY_LIMIT).toBe(14000);
  });

  it("errors when even the smallest size is too big", async () => {
    const r = await fitSnapshot("PNG", async () => "A".repeat(20000));
    expect(r).toEqual({ ok: false, ids: [], errors: ["snapshot too large"] });
  });
});

describe("fitDescription", () => {
  const size = (d: unknown) => new TextEncoder().encode(JSON.stringify(d)).length;
  const ink = (i: number): BoardItem => ({ id: `stroke${i}`, type: "ink", author: "user", bbox: { x: i, y: i, w: 10, h: 10 } });
  const tutorText = (i: number, len = 30): BoardItem => ({ id: `t${i}`, type: "text", author: "tutor", text: "w".repeat(len), bbox: { x: 0, y: 0, w: 1, h: 1 } });

  it("leaves a small board unchanged", () => {
    const d = { items: [tutorText(0), ink(1)] };
    expect(fitDescription(d)).toEqual(d);
  });

  it("merges student ink into one item when the reply is too big", () => {
    const d = { items: [tutorText(0), ...Array.from({ length: 300 }, (_, i) => ink(i))] };
    expect(size(d)).toBeGreaterThan(RPC_REPLY_LIMIT);
    const out = fitDescription(d);
    expect(size(out)).toBeLessThanOrEqual(RPC_REPLY_LIMIT);
    expect(out.items).toEqual([
      tutorText(0),
      { id: "user_ink", type: "ink", author: "user", label: "300 strokes", bbox: { x: 0, y: 0, w: 309, h: 309 } },
    ]);
  });

  it("drops the oldest items with a note when merging is not enough", () => {
    const d = { items: Array.from({ length: 200 }, (_, i) => tutorText(i, 120)) };
    const out = fitDescription(d);
    expect(size(out)).toBeLessThanOrEqual(RPC_REPLY_LIMIT);
    const note = out.items[out.items.length - 1];
    const omitted = 200 - (out.items.length - 1);
    expect(omitted).toBeGreaterThan(0);
    expect(note).toMatchObject({ type: "note", label: `(${omitted} items omitted)` });
    expect(out.items[out.items.length - 2].id).toBe("t199"); // newest kept
  });

  it("the describe RPC reply always fits", async () => {
    const big = { items: Array.from({ length: 2000 }, (_, i) => ink(i)) };
    const h = makeBoardRpcHandlers(() => ({ ...fakeBoard().board, describe: () => big }));
    expect(new TextEncoder().encode(await h["board.describe"]("{}")).length).toBeLessThanOrEqual(RPC_REPLY_LIMIT);
  });
});
