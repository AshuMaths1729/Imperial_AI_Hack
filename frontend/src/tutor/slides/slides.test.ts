import { describe, expect, it, vi } from "vitest";
import gd from "./decks/gradient-descent.json";
import { describeDeck, emptyDeck, goTo, pushSlide, slideErrors, stepTo } from "./deck";
import { makeSlidesRpcHandlers, type StageHandle } from "./rpc";
import { axesMap, dotXAt, evalExpr, functionPath, hopMs, slopeAt, stateAt, timeline } from "./scene";
import type { AxesObj, Deck, Slide, SlidesHandle } from "./types";

const deck = gd as unknown as Deck;
const byId = (id: string) => deck.slides.find((s) => s.id === id)!;

const tiny: Slide = {
  id: "s1",
  title: "T",
  objects: [
    { kind: "axes", id: "ax", x: 0, y: 0, w: 100, h: 100, x_range: [0, 10], y_range: [0, 10] },
    { kind: "curve", id: "c", axes: "ax", expr: "x" },
    { kind: "dot", id: "d", axes: "ax", curve: "c", x: 1 },
    { kind: "math", id: "m", latex: "a", x: 0, y: 0 },
  ],
  steps: [
    { narration: "one", actions: [{ do: "show", ids: ["c", "d"] }] },
    { narration: "two", actions: [{ do: "path", id: "d", xs: [2, 3] }, { do: "morph", id: "m", latex: "b", with_prev: true }] },
    { narration: "three", actions: [{ do: "hide", ids: ["c"] }, { do: "move", id: "d", to: 9 }] },
  ],
};

describe("scene", () => {
  it("objects shown by a step start hidden; the rest are visible when the slide opens", () => {
    const s0 = stateAt(tiny, 0);
    expect([...s0.visible].sort()).toEqual(["ax", "m"]);
    expect([...stateAt(tiny, 1).visible].sort()).toEqual(["ax", "c", "d", "m"]);
  });

  it("applies path, morph, hide and move in order, with a trail of visited points", () => {
    const s2 = stateAt(tiny, 2);
    expect(s2.dotX.d).toBe(3);
    expect(s2.trails.d).toEqual([1, 2]);
    expect(s2.latex.m).toBe("b");
    const s3 = stateAt(tiny, 3);
    expect(s3.visible.has("c")).toBe(false);
    expect(s3.dotX.d).toBe(9);
  });

  it("timeline runs actions in sequence unless with_prev", () => {
    const { items, total } = timeline(tiny, tiny.steps![1].actions);
    expect(items[0]).toMatchObject({ at: 0, dur: 2 * hopMs(2) });
    expect(items[1].at).toBe(0);
    const seq = timeline(tiny, tiny.steps![2].actions);
    expect(seq.items[1].at).toBe(seq.items[0].dur);
    expect(seq.total).toBe(seq.items[0].dur + seq.items[1].dur);
    expect(total).toBeGreaterThan(0);
  });

  it("dotXAt glides through each hop and lands on the targets", () => {
    const { items } = timeline(tiny, tiny.steps![1].actions);
    const per = hopMs(2);
    expect(dotXAt(items, "d", 1, 0)).toBe(1);
    expect(dotXAt(items, "d", 1, per / 2)).toBeCloseTo(1.5);
    expect(dotXAt(items, "d", 1, per)).toBeCloseTo(2);
    expect(dotXAt(items, "d", 1, 10_000)).toBe(3);
    expect(dotXAt(items, "other", 5, 100)).toBe(5);
    const roll = timeline(tiny, [{ do: "path", id: "d", xs: [2, 3], trail: false }]).items;
    expect(dotXAt(roll, "d", 1, per / 4)).toBeCloseTo(1.25); // linear: keeps rolling through iterates
  });

  it("evaluates expressions with params and reports bad ones as NaN", () => {
    expect(evalExpr("0.4*(x-0.5)^2+0.5", 0.5)).toBeCloseTo(0.5);
    expect(evalExpr("a*x", 2, { a: 3 })).toBe(6);
    expect(evalExpr("nope(x)", 1)).toBeNaN();
    expect(slopeAt("x^2", 3)).toBeCloseTo(6, 3);
  });

  it("maps axes units to the canvas (y up) and breaks paths where undefined", () => {
    const ax = tiny.objects[0] as AxesObj;
    const { X, Y } = axesMap(ax);
    expect([X(0), Y(0), X(10), Y(10)]).toEqual([0, 100, 100, 0]);
    expect(functionPath(ax, (x) => (x < 5 ? x : NaN), [0, 10], 10).match(/M/g)).toHaveLength(1);
    expect(functionPath(ax, (x) => (x === 5 ? NaN : x), [0, 10], 10).match(/M/g)).toHaveLength(2);
  });
});

describe("fallback deck", () => {
  it("passes the page-side checks and every dot path stays inside its axes", () => {
    for (const s of deck.slides) {
      expect(slideErrors(s), s.id).toEqual([]);
      const axes = new Map(s.objects.filter((o) => o.kind === "axes").map((o) => [o.id, o as AxesObj]));
      const final = stateAt(s, s.steps!.length);
      for (const o of s.objects) {
        if (o.kind !== "dot" || !o.curve) continue;
        const ax = axes.get(o.axes)!;
        const expr = (s.objects.find((c) => c.id === o.curve) as { expr: string }).expr;
        for (const x of [o.x, final.dotX[o.id], ...(final.trails[o.id] ?? [])]) {
          expect(x, `${s.id}.${o.id}`).toBeGreaterThanOrEqual(ax.x_range[0]);
          expect(x).toBeLessThanOrEqual(ax.x_range[1]);
          const y = evalExpr(expr, x);
          expect(y).toBeGreaterThanOrEqual(ax.y_range[0]);
          expect(y).toBeLessThanOrEqual(ax.y_range[1]);
        }
      }
    }
  });
});

describe("deck navigation", () => {
  const st = () => emptyDeck(deck.slides);

  it("go is 1-based and resets the step; out of range is an error", () => {
    const r = goTo(stepTo(st(), 2).state, 3);
    expect(r.errors).toEqual([]);
    expect([r.state.index, r.state.step]).toEqual([2, 0]);
    expect(goTo(st(), 0).errors[0]).toMatch(/1\.\.7/);
    expect(goTo(emptyDeck(), 1).errors[0]).toMatch(/no slides/);
  });

  it("step is bounded by the slide's step count", () => {
    expect(stepTo(st(), 4).state.step).toBe(4);
    expect(stepTo(st(), 5).errors[0]).toMatch(/0\.\.4/);
    expect(stepTo(st(), 1.5).errors).toHaveLength(1);
  });

  it("push inserts a follow-up after the open slide and opens it; clashing ids get a suffix", () => {
    const opened = goTo(st(), 2).state;
    const r = pushSlide(opened, { ...tiny, id: "loss" });
    expect(r.errors).toEqual([]);
    expect(r.state.index).toBe(2);
    expect(r.state.slides[2].id).toBe("loss-2");
    expect(r.state.slides).toHaveLength(8);
    expect(describeDeck(r.state).slides[2]).toMatchObject({ index: 3, followup: true });
  });

  it("push rejects slides with broken references", () => {
    const bad = { ...tiny, objects: [...tiny.objects, { kind: "tangent", id: "t", curve: "d", dot: "zz" }] };
    const r = pushSlide(st(), bad);
    expect(r.errors.join(" ")).toMatch(/t\.curve refers to d.*t\.dot refers to zz/);
    expect(pushSlide(st(), "nope").errors).toEqual(["slide needs id, title and objects"]);
    expect(r.state.slides).toHaveLength(7);
  });

  it("describe gives the outline and the open slide's objects and narration, within the RPC limit", () => {
    const d = describeDeck(goTo(st(), 3).state);
    expect(d.index).toBe(3);
    expect(d.slides.map((s) => s.title)).toContain("Momentum: a heavy ball");
    expect(d.current!.objects.find((o) => o.id === "tan")).toEqual({ id: "tan", kind: "tangent" });
    expect(d.current!.narration).toHaveLength(byId("gradient").steps!.length);
    const small = describeDeck(goTo(st(), 3).state, 1500);
    expect(new TextEncoder().encode(JSON.stringify(small)).length).toBeLessThanOrEqual(1500);
    expect(small.slides.some((s) => s.index === 3)).toBe(true);
  });
});

describe("slides rpc", () => {
  function setup(slides: Partial<SlidesHandle> | null = {}) {
    const handle = slides && {
      go: vi.fn(() => ({ ok: true, errors: [] })),
      step: vi.fn(() => ({ ok: false, errors: ["step must be 0..3 on this slide"] })),
      point: vi.fn(() => ({ ok: true, errors: [] })),
      describe: vi.fn(() => ({ ok: true as const, index: 1, step: 0, slides: [], current: null })),
      push: vi.fn(() => ({ ok: true, errors: [] })),
      current: vi.fn(() => tiny),
      ...slides,
    };
    const stage: StageHandle = { showTab: vi.fn(), slides: handle };
    return { stage, h: makeSlidesRpcHandlers(() => stage) };
  }

  it("ui.show_tab switches tabs and validates the name", async () => {
    const { stage, h } = setup();
    expect(JSON.parse(await h["ui.show_tab"](JSON.stringify({ tab: "slides" })))).toMatchObject({ ok: true });
    expect(stage.showTab).toHaveBeenCalledWith("slides");
    expect(JSON.parse(await h["ui.show_tab"](JSON.stringify({ tab: "tv" }))).ok).toBe(false);
  });

  it("driving the deck forwards the payload and brings the Slides tab up only on success", async () => {
    const { stage, h } = setup();
    await h["slides.go"](JSON.stringify({ index: 2 }));
    expect(stage.slides!.go).toHaveBeenCalledWith(2);
    expect(stage.showTab).toHaveBeenCalledWith("slides");
    (stage.showTab as ReturnType<typeof vi.fn>).mockClear();
    const r = JSON.parse(await h["slides.step"](JSON.stringify({ step: 9 })));
    expect(r.errors[0]).toMatch(/0\.\.3/);
    expect(stage.showTab).not.toHaveBeenCalled();
    await h["slides.point"](JSON.stringify({ id: "tan", hold_ms: 1000 }));
    expect(stage.slides!.point).toHaveBeenCalledWith("tan", 1000);
    await h["slides.push"](JSON.stringify({ slide: tiny }));
    expect(stage.slides!.push).toHaveBeenCalledWith(tiny);
  });

  it("describe adds the open slide's JSON only when asked and when it fits", async () => {
    const { h } = setup();
    expect(JSON.parse(await h["slides.describe"]("{}")).slide).toBeUndefined();
    expect(JSON.parse(await h["slides.describe"]('{"slide":true}')).slide).toEqual(tiny);
    const big = { ...tiny, objects: Array.from({ length: 400 }, (_, i) => ({ kind: "text", id: `t${i}`, text: "x".repeat(30), x: 0, y: 0 })) };
    const r = JSON.parse(await setup({ current: vi.fn(() => big as Slide) }).h["slides.describe"]('{"slide":true}'));
    expect(r.ok).toBe(true);
    expect(r.slide).toBeUndefined();
  });

  it("never throws: bad JSON, no stage, no deck", async () => {
    const { h } = setup();
    expect(JSON.parse(await h["slides.go"]("{")).ok).toBe(false);
    expect(JSON.parse(await h["slides.go"]("[]")).errors).toEqual(["payload must be a JSON object"]);
    expect(JSON.parse(await setup(null).h["slides.describe"]("{}")).errors[0]).toMatch(/no slides/);
    expect(JSON.parse(await makeSlidesRpcHandlers(() => null)["ui.show_tab"]("{}")).errors[0]).toMatch(/not ready/);
  });
});
