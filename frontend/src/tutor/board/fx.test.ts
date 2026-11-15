import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor, TLShapeId } from "tldraw";
import { BoardFx, GLIDE_MS, glowMs } from "./fx";

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

describe("laser trace and highlight", () => {
  afterEach(() => vi.useRealTimers());
  const row = [[{ x: 0, y: 30 }, { x: 300, y: 30 }]];
  const mark = { path: [[{ x: 0, y: 15 }, { x: 300, y: 15 }]], width: 30 };

  it("glides to the line's start, then travels along it and stays parked at its end", () => {
    vi.useFakeTimers();
    const fx = new BoardFx(fakeEditor());
    fx.trace(row, mark);
    expect(fx.laser.get()).toMatchObject({ x: 0, y: 30 });
    vi.advanceTimersByTime(GLIDE_MS + 500);
    const mid = fx.laser.get()!;
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(300);
    expect(mid.travel).toBe(true); // no CSS glide while travelling: it moves with the voice, frame by frame
    vi.advanceTimersByTime(10_000);
    expect(fx.laser.get()).toEqual({ x: 300, y: 30, travel: false });
    fx.dispose();
  });

  it("the pointed item glows while the laser travels, then the glow goes (it is never stored)", () => {
    vi.useFakeTimers();
    const fx = new BoardFx(fakeEditor());
    fx.trace(row, mark);
    expect(fx.glow.get()).toBeNull();
    vi.advanceTimersByTime(GLIDE_MS);
    expect(fx.glow.get()).toMatchObject({ path: mark.path, width: 30 });
    const life = glowMs(fx.glow.get()!.ms);
    expect(life).toBeGreaterThanOrEqual(1500);
    vi.advanceTimersByTime(life + 10);
    expect(fx.glow.get()).toBeNull();
    fx.dispose();
  });

  it("a new point takes over: the old travel stops and the old glow cannot clear the new one", () => {
    vi.useFakeTimers();
    const fx = new BoardFx(fakeEditor());
    fx.trace(row, mark);
    vi.advanceTimersByTime(GLIDE_MS + 300);
    const other = { path: [[{ x: 0, y: 500 }, { x: 100, y: 500 }]], width: 30 };
    fx.trace([[{ x: 0, y: 515 }, { x: 100, y: 515 }]], other);
    expect(fx.laser.get()).toMatchObject({ x: 0, y: 515 });
    vi.advanceTimersByTime(GLIDE_MS + 50);
    expect(fx.glow.get()?.path).toBe(other.path);
    vi.advanceTimersByTime(10_000);
    expect(fx.laser.get()).toMatchObject({ x: 100, y: 515 });
    expect(fx.glow.get()).toBeNull();
    fx.dispose();
  });

  it("reduced motion: the laser jumps to the item, no travel and no glow", () => {
    vi.useFakeTimers();
    const mm = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const fx = new BoardFx(fakeEditor());
    fx.trace(row, mark);
    vi.advanceTimersByTime(10_000);
    expect(fx.laser.get()).toEqual({ x: 0, y: 30 });
    expect(fx.glow.get()).toBeNull();
    mm.mockRestore();
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
