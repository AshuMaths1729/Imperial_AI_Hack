import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import type { CircleEvent } from "@/tutor/contracts/types";
import gd from "./decks/gradient-descent.json";
import { LASER_PARK } from "./lasso";
import { SlidesStage } from "./SlidesStage";
import type { Deck, SlidesHandle } from "./types";

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
    expect(r.ms).toBe(1500); // the inserted step: "L" written in (1.5 s minimum)
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
});
