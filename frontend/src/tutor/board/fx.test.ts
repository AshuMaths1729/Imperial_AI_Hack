import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor, TLShapeId } from "tldraw";
import { BoardFx } from "./fx";

const fakeEditor = () => ({ on: vi.fn(), off: vi.fn() }) as unknown as Editor;

describe("laser", () => {
  afterEach(() => vi.useRealTimers());

  it("stays on at its last target until the next point_at moves it", () => {
    vi.useFakeTimers();
    const fx = new BoardFx(fakeEditor());
    expect(fx.laser.get()).toBeNull();
    fx.point(100, 200);
    vi.advanceTimersByTime(60_000);
    expect(fx.laser.get()).toEqual({ x: 100, y: 200 });
    fx.point(300, 50);
    expect(fx.laser.get()).toEqual({ x: 300, y: 50 });
    fx.dispose();
  });
});

describe("writing", () => {
  afterEach(() => vi.useRealTimers());
  const css = () => [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("\n");

  it("writes without a pen icon: outline leads, ink follows, then the shape is left plain; writes queue in order", () => {
    vi.useFakeTimers();
    const fx = new BoardFx(fakeEditor());
    const a = "shape:a" as TLShapeId, b = "shape:b" as TLShapeId;
    fx.write(a, 1, 4000);
    fx.write(b, 1, 2000);
    expect(css()).toContain('.tl-shape[data-shape-id="shape:a"]{animation: tw-clip-1 3600ms linear both}');
    expect(css()).toContain('.tl-shape[data-shape-id="shape:a"] .tw-ink{animation: tw-clip-1 3600ms linear 400ms both}');
    expect(css()).toContain('.tl-shape[data-shape-id="shape:b"]{clip-path: polygon(0 0, 0 0, 0 0)}'); // waits its turn
    vi.advanceTimersByTime(4200);
    expect(css()).not.toContain("shape:a");
    expect(css()).toContain('.tl-shape[data-shape-id="shape:b"]{animation: tw-clip-1 1600ms linear both}');
    expect("tips" in fx).toBe(false);
    fx.dispose();
  });
});
