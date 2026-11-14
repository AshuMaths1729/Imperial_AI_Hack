import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";
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
