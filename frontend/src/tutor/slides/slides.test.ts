import { describe, expect, it, vi } from "vitest";
import gd from "./decks/gradient-descent.json";
import { describeDeck, editSlide, emptyDeck, goTo, pushSlide, slideErrors, stepTo } from "./deck";
import { laserSpot, LASER_PARK } from "./lasso";
import { makeSlidesRpcHandlers, type StageHandle } from "./rpc";
import { axesMap, dotXAt, entranceMs, evalExpr, functionPath, hopMs, PACE, slopeAt, stateAt, stepMs, timeline, writeMs } from "./scene";
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

describe("pacing", () => {
  it("step animations run 1.6x the v2 durations", () => {
    expect(PACE).toBe(1.6);
    expect(timeline(tiny, [{ do: "hide", ids: ["c"] }]).total).toBe(720);
    expect(timeline(tiny, [{ do: "move", id: "d", to: 2 }]).total).toBe(1760);
    expect(timeline(tiny, [{ do: "morph", id: "c", expr: "2*x" }]).total).toBe(1600);
    expect(entranceMs(tiny.objects[0])).toBe(1440); // axes: 900 -> 1440
  });

  it("equations and text are written at speaking pace: ~20 characters in 4 s, at least 1.5 s each", () => {
    const m = (latex: string) => ({ kind: "math" as const, id: "m", latex, x: 0, y: 0 });
    const t = (text: string) => ({ kind: "text" as const, id: "t", text, x: 0, y: 0 });
    expect(writeMs(m("x"))).toBe(1500);
    expect(writeMs(t("x".repeat(20)))).toBe(4000);
    expect(writeMs(t("twenty chars of text"))).toBe(3400); // spaces are not written: 17 glyphs
    expect(writeMs(m("f'(x)=\\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}"))).toBeGreaterThan(writeMs(m("y=2x")));
    // colour arguments and layout commands are not rendered glyphs
    expect(writeMs(m("\\textcolor{#F0AC5F}{\\theta} = \\theta - 2x + 10"))).toBe(writeMs(m("\\theta = \\theta - 2x + 10")));
    expect(writeMs(m("\\frac{abcdefgh}{ijkl}\\,\\;c"))).toBe(writeMs(m("abcdefghijklc")));
    expect(writeMs(m("x".repeat(500)))).toBe(10000); // capped so one long line can't stall the lesson
    expect(entranceMs(m("y=2x"))).toBe(writeMs(m("y=2x")));
  });

  it("stepMs is how long the next step's animation runs; jumps and going back are instant", () => {
    expect(stepMs(tiny, 1, 2)).toBe(timeline(tiny, tiny.steps![1].actions).total);
    expect(stepMs(tiny, 0, 1)).toBeGreaterThan(0);
    expect(stepMs(tiny, 0, 3)).toBe(0);
    expect(stepMs(tiny, 2, 1)).toBe(0);
    expect(stepMs(tiny, 2, 2)).toBe(0);
  });
});

describe("laser", () => {
  it("parks left of the title; sits under text and on the centre of shapes", () => {
    expect(LASER_PARK.x).toBeLessThan(80); // the title starts at x=80
    expect(LASER_PARK.y).toBeGreaterThan(44);
    const box = { x: 100, y: 200, w: 40, h: 20 };
    expect(laserSpot(box, false)).toEqual({ x: 120, y: 210 });
    expect(laserSpot(box, true)).toEqual({ x: 120, y: 234 });
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
    expect(d.current!.idea).toBe(byId("gradient").idea); // the demo deck carries the lesson plan
    const planned = { ...emptyDeck(deck.slides), slides: [{ ...tiny, idea: "One idea.", check: "What happens next?" }] };
    expect(describeDeck(planned).current).toMatchObject({ idea: "One idea.", check: "What happens next?" });
    const small = describeDeck(goTo(st(), 3).state, 1500);
    expect(new TextEncoder().encode(JSON.stringify(small)).length).toBeLessThanOrEqual(1500);
    expect(small.slides.some((s) => s.index === 3)).toBe(true);
  });
});

describe("edit in place", () => {
  const opened = () => stepTo(emptyDeck(deck.slides), 2).state; // slide 1 (landscape), 2 of 4 steps shown
  const patch = {
    objects: [
      { kind: "math", id: "eq", latex: "L(\\theta)", x: 1200, y: 300, color: "blue" },
      { kind: "dot", id: "here", axes: "ax", curve: "loss", x: 1 },
    ],
    steps: [
      { narration: "This is the height.", actions: [{ do: "show", ids: ["eq"] }, { do: "indicate", ids: ["loss"], with_prev: true }] },
      { narration: "And here.", actions: [{ do: "show", ids: ["here"] }, { do: "hide", ids: ["you"] }] },
    ],
  };

  it("adds objects, inserts the steps right after the current one, and keeps the current step", () => {
    const r = editSlide(opened(), patch);
    expect(r.errors).toEqual([]);
    expect(r.newSteps).toEqual([3, 4]);
    const s = r.state.slides[0];
    expect([r.state.index, r.state.step]).toEqual([0, 2]);
    expect(s.id).toBe("landscape");
    expect(s.objects.slice(-2).map((o) => o.id)).toEqual(["eq", "here"]);
    expect(s.steps!.map((x) => x.narration)).toEqual([
      ...deck.slides[0].steps!.slice(0, 2).map((x) => x.narration),
      "This is the height.",
      "And here.",
      ...deck.slides[0].steps!.slice(2).map((x) => x.narration), // later steps renumbered 5, 6
    ]);
    expect(r.state.slides).toHaveLength(deck.slides.length); // not a new slide
    expect(describeDeck(r.state).slides[0].steps).toBe(6);
    // what is on screen now is unchanged; the new objects wait for their steps
    expect([...stateAt(s, 2).visible].sort()).toEqual([...stateAt(deck.slides[0], 2).visible].sort());
    expect(stateAt(s, 3).visible.has("eq")).toBe(true);
    expect(stateAt(s, 4).visible.has("you")).toBe(false);
    expect(stateAt(s, 6).visible.has("fog")).toBe(true); // the old last step still runs
    expect(deck.slides[0].steps).toHaveLength(4); // the original is not mutated
  });

  it("objects no step shows appear at once; steps alone may only use existing objects", () => {
    const r = editSlide(opened(), { objects: [{ kind: "text", id: "note", text: "height", x: 1200, y: 200 }] });
    expect(r.errors).toEqual([]);
    expect(r.newSteps).toEqual([]);
    expect(stateAt(r.state.slides[0], 2).visible.has("note")).toBe(true);
    expect(editSlide(opened(), { steps: [{ narration: "look", actions: [{ do: "indicate", ids: ["you"] }] }] }).newSteps).toEqual([3]);
  });

  it("rejects reused ids, broken references, bad shapes and re-showing what is already on screen", () => {
    const st = opened();
    expect(editSlide(st, { objects: [{ kind: "text", id: "fog", text: "x", x: 0, y: 0 }] }).errors[0]).toMatch(/fog is already on this slide/);
    expect(editSlide(st, { objects: [{ kind: "dot", id: "p", axes: "nope", x: 0 }] }).errors[0]).toMatch(/p\.axes refers to nope/);
    expect(editSlide(st, { steps: [{ narration: "x", actions: [{ do: "show", ids: ["zz"] }] }] }).errors[0]).toMatch(/step 3 show: unknown object zz/);
    expect(editSlide(st, { steps: [{ narration: "x", actions: [{ do: "show", ids: ["ax"] }] }] }).errors).toEqual([]); // shown by a step: a no-op
    expect(editSlide(emptyDeck([tiny]), { steps: [{ narration: "x", actions: [{ do: "show", ids: ["m"] }] }] }).errors[0]).toMatch(/step 1 show: m is on screen from the start/);
    expect(editSlide(st, { steps: [{ actions: [] }] }).errors[0]).toMatch(/step 3 needs narration/);
    expect(editSlide(st, { steps: [{ narration: "x", actions: ["show"] }] }).errors[0]).toMatch(/step 3/);
    expect(editSlide(st, { objects: "nope" as unknown as unknown[] }).errors[0]).toMatch(/lists/);
    expect(editSlide(st, {}).errors[0]).toMatch(/nothing to add/);
    expect(editSlide(emptyDeck(), patch).errors[0]).toMatch(/no slides/);
    expect(editSlide(st, { objects: [{ kind: "text", id: "fog", text: "x", x: 0, y: 0 }] }).state).toBe(st);
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
      edit: vi.fn(() => ({ ok: true, errors: [] })),
      clearCircle: vi.fn(() => ({ ok: true, errors: [] })),
      explain: vi.fn(() => ({ ok: true, errors: [] })),
      explainStep: vi.fn(() => ({ ok: true, errors: [] })),
      closeExplanation: vi.fn(() => ({ ok: true, errors: [] })),
      current: vi.fn(() => tiny),
      ...slides,
    };
    const stage: StageHandle = { showTab: vi.fn(), slides: handle, clearCircle: vi.fn() };
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
    await h["slides.edit"](JSON.stringify({ objects: [tiny.objects[3]], steps: [] }));
    expect(stage.slides!.edit).toHaveBeenCalledWith({ objects: [tiny.objects[3]], steps: [] });
  });

  it("ui.clear_circle clears the mark by id wherever it is", async () => {
    const { stage, h } = setup();
    expect(JSON.parse(await h["ui.clear_circle"](JSON.stringify({ circle_id: "c1" })))).toEqual({ ok: true, errors: [], circle_id: "c1" });
    expect(stage.clearCircle).toHaveBeenCalledWith("c1");
    expect(JSON.parse(await h["ui.clear_circle"]("{}")).errors[0]).toMatch(/circle_id/);
    expect(JSON.parse(await setup(null).h["ui.clear_circle"](JSON.stringify({ circle_id: "c2" }))).ok).toBe(true); // board circles: no deck needed
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
