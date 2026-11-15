import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { CircleEvent } from "@/tutor/contracts/types";
import gd from "./decks/gradient-descent.json";
import { LASER_PARK } from "./lasso";
import { AUTO_POINT_MS, SlidesStage } from "./SlidesStage";
import { SlideView } from "./SlideView";
import type { Deck, Slide, SlidesHandle } from "./types";

const deck = gd as unknown as Deck;
afterEach(cleanup);

function mount(props: Partial<React.ComponentProps<typeof SlidesStage>> = {}) {
  const ref = createRef<SlidesHandle>();
  const view = render(<SlidesStage ref={ref} deck={deck} {...props} />);
  return { ref, view, h: () => ref.current! };
}
const laserAt = () => {
  const el = screen.getByTestId("slide-laser");
  return { transform: el.style.transform, opacity: el.style.opacity };
};

describe("SlidesStage", () => {
  it("the laser is parked near the title from the start and never fades", () => {
    vi.useFakeTimers();
    try {
      const { h } = mount();
      expect(laserAt().transform).toBe(`translate(${LASER_PARK.x}px, ${LASER_PARK.y}px)`);
      act(() => void h().step(1));
      act(() => void h().point("ax"));
      act(() => void vi.advanceTimersByTime(20_000));
      expect(laserAt().opacity).toBe("1");
      act(() => void h().go(2));
      expect(laserAt()).toEqual({ transform: `translate(${LASER_PARK.x}px, ${LASER_PARK.y}px)`, opacity: "1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("step replies say how long the step animates", () => {
    const { h } = mount();
    let r!: ReturnType<SlidesHandle["step"]>;
    act(() => void (r = h().step(1)));
    expect(r).toMatchObject({ ok: true, step: 1 });
    expect(r.ms).toBeGreaterThan(1000);
    act(() => void (r = h().step(3)));
    expect(r.ms).toBe(0); // a jump is not replayed
  });

  it("edit inserts steps after the current one without playing them or leaving the current step", () => {
    const { h } = mount();
    act(() => void h().step(2));
    let r!: ReturnType<SlidesHandle["edit"]>;
    act(() => void (r = h().edit({ objects: [{ kind: "math", id: "eq", latex: "L", x: 1200, y: 300 }], steps: [{ narration: "n", actions: [{ do: "show", ids: ["eq"] }] }] })));
    expect(r).toEqual({ ok: true, errors: [], index: 1, step: 2, steps_added: 1, new_steps: [3] });
    expect(h().describe().current!.narration[2]).toBe("n");
    expect(h().describe().slides[0].steps).toBe(5);
    expect(screen.getByLabelText("Step 2 of 5")).toBeTruthy();
    act(() => void (r = h().step(3)));
    expect(r.ms).toBe(250); // the inserted step: "L" fades in almost at once (v3.2)
    expect(h().edit({ objects: [{ kind: "text", id: "eq", text: "x", x: 0, y: 0 }] }).ok).toBe(false);
  });

  it("a circle stays drawn with a ? badge and a fresh id until it is cleared by id", async () => {
    const events: CircleEvent[] = [];
    const { h, view, ref } = mount({ circleMode: true, onCircle: (e) => events.push(e) });
    const draw = async (x: number) => {
      const lasso = screen.getByTestId("slide-lasso");
      lasso.setPointerCapture = () => {};
      fireEvent.pointerDown(lasso, { clientX: x, clientY: 100, pointerId: 1 });
      for (const [dx, dy] of [[60, 0], [60, 60], [0, 60], [0, 0]]) fireEvent.pointerMove(lasso, { clientX: x + dx, clientY: 100 + dy, pointerId: 1 });
      await act(async () => void fireEvent.pointerUp(lasso, { pointerId: 1 }));
    };
    await draw(100);
    await draw(400);
    expect(events).toHaveLength(2);
    const [a, b] = events.map((e) => e.circle_id!);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    view.rerender(<SlidesStage ref={ref} deck={deck} circleMode={false} />);
    expect(screen.getAllByTestId("slide-circle")).toHaveLength(2);
    expect(screen.getAllByText("?")).toHaveLength(2);
    act(() => void h().clearCircle(a));
    expect(screen.getAllByTestId("slide-circle")).toHaveLength(1);
    expect(h().clearCircle("nope").ok).toBe(false);
    act(() => void h().clearCircle(b));
    expect(screen.queryAllByTestId("slide-circle")).toHaveLength(0);
  });

  it("an edit (the tutor starts explaining) clears the student's circles on that slide; ui.clear_circle after it is harmless", async () => {
    const events: CircleEvent[] = [];
    const { h } = mount({ circleMode: true, onCircle: (e) => events.push(e) });
    const lasso = screen.getByTestId("slide-lasso");
    lasso.setPointerCapture = () => {};
    fireEvent.pointerDown(lasso, { clientX: 100, clientY: 100, pointerId: 1 });
    for (const [x, y] of [[160, 100], [160, 160], [100, 160], [100, 100]]) fireEvent.pointerMove(lasso, { clientX: x, clientY: y, pointerId: 1 });
    await act(async () => void fireEvent.pointerUp(lasso, { pointerId: 1 }));
    expect(screen.getAllByTestId("slide-circle")).toHaveLength(1);
    act(() => void h().edit({ objects: [{ kind: "text", id: "why", text: "because", x: 1200, y: 300 }] }));
    expect(screen.queryAllByTestId("slide-circle")).toHaveLength(0);
    let r!: ReturnType<SlidesHandle["clearCircle"]>;
    act(() => void (r = h().clearCircle(events[0].circle_id!)));
    expect(r.ok).toBe(true);
  });

  it("writes without a pen icon; the laser is one dot with no ring", () => {
    const { h, view } = mount();
    act(() => void h().step(1));
    act(() => void h().point("ax"));
    expect(view.container.querySelector("[data-pen]")).toBeNull();
    expect(screen.getByTestId("slide-laser").children).toHaveLength(1);
  });

  const why: Slide = {
    id: "why",
    title: "Why the slope is rise over run",
    objects: [
      { kind: "axes", id: "x_ax", x: 100, y: 100, w: 800, h: 600, x_range: [0, 4], y_range: [0, 8] },
      { kind: "polyline", id: "x_run", axes: "x_ax", points: [[1, 2], [3, 2]], color: "green" },
      { kind: "polyline", id: "x_rise", axes: "x_ax", points: [[3, 2], [3, 6]], color: "purple" },
    ],
    steps: [
      { narration: "run", actions: [{ do: "show", ids: ["x_run"] }] },
      { narration: "rise", actions: [{ do: "show", ids: ["x_rise"] }] },
    ],
  };

  it("explain opens a pop-up with its own slide; steps reply with ms; close removes it; the main slide is untouched", () => {
    const { h } = mount();
    act(() => void h().step(1));
    expect(h().explainStep(1).ok).toBe(false); // nothing open yet
    let r!: ReturnType<SlidesHandle["explain"]>;
    act(() => void (r = h().explain(why)));
    expect(r).toEqual({ ok: true, errors: [], step: 0 });
    const card = screen.getByTestId("explanation");
    expect(card.textContent).toContain("Explaining: Why the slope is rise over run");
    expect(card.querySelector("[data-title]")).toBeNull(); // the title is in the card's bar
    act(() => void (r = h().explainStep(1)));
    expect(r).toMatchObject({ ok: true, step: 1 });
    expect(r.ms).toBeGreaterThan(1000); // the run is drawn
    expect(h().explainStep(3).errors[0]).toMatch(/0\.\.2/);
    expect(h().describe()).toMatchObject({ index: 1, step: 1 }); // the main slide stays where it was
    act(() => void (r = h().closeExplanation()));
    expect(r.ok).toBe(true);
    expect(screen.queryByTestId("explanation")).toBeNull();
    expect(h().explain({ id: "bad" }).errors[0]).toMatch(/needs id, title and objects/);
  });

  it("point routes pop-up ids to the pop-up's laser and slide ids to the slide's; only one laser shows", () => {
    const { h } = mount();
    act(() => void h().step(1));
    act(() => void h().explain(why));
    expect(screen.getByTestId("slide-laser").style.opacity).toBe("0");
    expect(screen.getByTestId("explain-laser").style.opacity).toBe("1");
    expect(h().point("x_run").errors[0]).toMatch(/not on screen in the explanation/);
    act(() => void h().explainStep(1));
    let r!: ReturnType<SlidesHandle["point"]>;
    act(() => void (r = h().point("x_run")));
    expect(r).toMatchObject({ ok: true, step: 1 });
    act(() => void (r = h().point("ax")));
    expect(r).toMatchObject({ ok: true, index: 1 });
    expect(screen.getByTestId("slide-laser").style.opacity).toBe("1");
    expect(screen.getByTestId("explain-laser").style.opacity).toBe("0");
    expect(h().point("zz").errors[0]).toMatch(/no object zz on this slide or in the explanation/);
  });

  it("docks the pop-up into the given slot as its only child, and leaves the slot empty when closed", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    try {
      const { h } = mount({ explanationSlot: slot });
      expect(slot.childNodes).toHaveLength(0);
      act(() => void h().explain(why));
      expect(slot.childNodes).toHaveLength(1);
      expect(slot.firstElementChild!.getAttribute("data-testid")).toBe("explanation");
      act(() => void h().closeExplanation());
      expect(slot.childNodes).toHaveLength(0);
    } finally {
      slot.remove();
    }
  });

  it("leaving the slide closes the pop-up", () => {
    const { h } = mount();
    act(() => void h().explain(why));
    act(() => void h().go(2));
    expect(screen.queryByTestId("explanation")).toBeNull();
  });

  it("a step with no laser cue points at its main object; a cue after the step wins", () => {
    vi.useFakeTimers();
    // jsdom has no layout: give every object a box (x by id) inside a full-size canvas
    const xs: Record<string, number> = { ax: 100, you: 300, goal: 500 };
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const id = (this as HTMLElement).dataset?.obj;
      const r = id ? { x: xs[id] ?? 700, y: 200, width: 40, height: 20 } : { x: 0, y: 0, width: 1600, height: 900 };
      return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => r } as DOMRect;
    });
    try {
      const { h } = mount();
      act(() => void h().step(1)); // shows ax, loss: no cue comes
      expect(laserAt().transform).toBe(`translate(${LASER_PARK.x}px, ${LASER_PARK.y}px)`);
      act(() => void vi.advanceTimersByTime(AUTO_POINT_MS + 10));
      expect(laserAt().transform).toBe("translate(120px, 210px)"); // on the axes
      act(() => void h().step(2)); // shows "you"; the tutor's cue points at the goal instead
      act(() => void h().step(3));
      act(() => void h().point("goal"));
      act(() => void vi.advanceTimersByTime(AUTO_POINT_MS + 10));
      expect(laserAt().transform).toBe("translate(520px, 210px)");
      act(() => void h().step(4)); // shows fog (text): the laser sits under it
      act(() => void vi.advanceTimersByTime(AUTO_POINT_MS + 10));
      expect(laserAt().transform).toBe("translate(720px, 234px)");
    } finally {
      rect.mockRestore();
      vi.useRealTimers();
    }
  });

  it("what the student circled stays softly highlighted on the main slide while a pop-up explains it", () => {
    const { container } = render(<SlideView slide={why} step={2} motion={false} highlight={["x_run"]} />);
    expect((container.querySelector('[data-obj="x_run"]') as HTMLElement).style.filter).toMatch(/drop-shadow/);
    expect((container.querySelector('[data-obj="x_rise"]') as HTMLElement).style.filter).toBe("");
  });
});
