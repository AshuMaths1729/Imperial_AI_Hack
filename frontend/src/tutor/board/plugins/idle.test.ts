import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";
import type { BoardItem, IdleEvent } from "../../contracts/types";
import { IDLE_MS, makeIdlePlugin, padRegion } from "./idle";

type Shape = { id: string; type: string; meta: { author?: string }; props: { isComplete?: boolean } };
type Handlers = { create: ((s: Shape) => void)[]; change: ((p: Shape, n: Shape) => void)[]; del: ((s: Shape) => void)[] };

function setup(items: BoardItem[] = []) {
  const h: Handlers = { create: [], change: [], del: [] };
  const off = vi.fn();
  const reg = (list: unknown[]) => (_type: string, fn: never) => { list.push(fn); return off; };
  const editor = {
    sideEffects: {
      registerAfterCreateHandler: reg(h.create),
      registerAfterChangeHandler: reg(h.change),
      registerAfterDeleteHandler: reg(h.del),
    },
  } as unknown as Editor;
  const emit = vi.fn();
  const snapshot = vi.fn(async () => "PNG");
  const board = { items };
  const encode = vi.fn(async (_png: string, side: number) => "J".repeat(side));
  const cleanup = makeIdlePlugin({ encodeJpeg: encode, maxBytes: 600 })({ editor, emit, snapshot, describe: () => board });

  const ink = (id: string) => ({ id: `shape:${id}`, type: "draw", meta: { author: "user" }, props: { isComplete: false } });
  /** One student stroke: created incomplete, then finished on pen-up. */
  const stroke = (id: string) => {
    const s = ink(id);
    h.create.forEach((f) => f(s));
    const done = { ...s, props: { isComplete: true } };
    h.change.forEach((f) => f(s, done));
    return done;
  };
  return { h, emit, snapshot, encode, cleanup, off, board, ink, stroke };
}

const item = (id: string, x: number, y: number, author: "user" | "tutor" = "user"): BoardItem =>
  ({ id, type: author === "user" ? "ink" : "math", author, bbox: { x, y, w: 100, h: 40 } });

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("idle plugin", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits one tutor.idle with the recent ink region after the student pauses", async () => {
    const t = setup([item("a", 100, 1200), item("b", 250, 1210), item("old", 100, 200), item("q1", 0, 1000, "tutor")]);
    t.stroke("a");
    vi.advanceTimersByTime(2000);
    t.stroke("b");
    vi.advanceTimersByTime(IDLE_MS - 1);
    await flush();
    expect(t.emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await flush();
    expect(t.emit).toHaveBeenCalledTimes(1);
    const [topic, ev] = t.emit.mock.calls[0] as [string, IdleEvent];
    expect(topic).toBe("tutor.idle");
    expect(ev.item_ids).toEqual(["a", "b"]);
    expect(ev.region).toEqual(padRegion({ x: 100, y: 1200, w: 250, h: 50 }));
    expect(t.snapshot).toHaveBeenCalledWith(ev.region);
    expect(ev.mime).toBe("image/jpeg");
    expect(ev.idle_ms).toBeGreaterThanOrEqual(IDLE_MS);
    vi.advanceTimersByTime(IDLE_MS * 3);
    await flush();
    expect(t.emit).toHaveBeenCalledTimes(1); // one event per pause
  });

  it("does not fire while a stroke is still being drawn", async () => {
    const t = setup([item("a", 100, 100)]);
    t.stroke("a");
    vi.advanceTimersByTime(IDLE_MS - 100);
    t.h.create.forEach((f) => f(t.ink("b"))); // pen down again, held for a long time
    vi.advanceTimersByTime(IDLE_MS * 2);
    await flush();
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("ignores tutor shapes", async () => {
    const t = setup([item("q1", 100, 100, "tutor")]);
    t.h.create.forEach((f) => f({ id: "shape:q1", type: "math", meta: { author: "tutor" }, props: {} }));
    vi.advanceTimersByTime(IDLE_MS * 2);
    await flush();
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("ignores the Circle-to-Ask lasso, which is deleted right after it is drawn", async () => {
    const t = setup([]);
    const lasso = t.stroke("lasso");
    t.h.del.forEach((f) => f(lasso));
    vi.advanceTimersByTime(IDLE_MS * 2);
    await flush();
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("keeps the JSON payload under the size budget by shrinking the JPEG", async () => {
    const t = setup([item("a", 100, 100)]);
    t.stroke("a");
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    const ev = t.emit.mock.calls[0][1] as IdleEvent;
    expect(JSON.stringify(ev).length).toBeLessThanOrEqual(600);
    expect(ev.png_b64.length).toBe(384); // 768 and 512 px did not fit 600 bytes
  });

  it("drops the event when even the smallest image is too big", async () => {
    const t = setup([item("a", 100, 100)]);
    t.encode.mockImplementation(async () => "J".repeat(5000));
    t.stroke("a");
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("cleans up its handlers and pending timer", async () => {
    const t = setup([item("a", 100, 100)]);
    t.stroke("a");
    t.cleanup?.();
    expect(t.off).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(IDLE_MS * 2);
    await flush();
    expect(t.emit).not.toHaveBeenCalled();
  });
});

describe("padRegion", () => {
  it("pads and clips to the 1000x3000 board", () => {
    expect(padRegion({ x: 10, y: 2980, w: 980, h: 15 })).toEqual({ x: 0, y: 2940, w: 1000, h: 60 });
  });
});
