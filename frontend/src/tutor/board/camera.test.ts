import { describe, expect, it, vi } from "vitest";
import { cameraFor, fitBoardCamera, followPaused, inClearView, INSETS, MAX_ZOOM, type CameraEditor } from "./camera";

function fakeEditor(w: number, h: number) {
  const container = {} as HTMLElement;
  const e = {
    getContainer: vi.fn(() => container),
    updateViewportScreenBounds: vi.fn(),
    getViewportScreenBounds: vi.fn(() => ({ w, h })),
    setCameraOptions: vi.fn(),
    getCamera: vi.fn(() => ({ x: 0, y: 0, z: 1 })),
    setCamera: vi.fn(),
  };
  return e as typeof e & CameraEditor;
}

describe("fitBoardCamera", () => {
  it("measures the container before fitting", () => {
    const e = fakeEditor(800, 600);
    fitBoardCamera(e);
    expect(e.updateViewportScreenBounds).toHaveBeenCalledWith(e.getContainer());
  });

  it("does not fit while the viewport has no size (fit-x would divide by zero)", () => {
    const e = fakeEditor(0, 0);
    expect(fitBoardCamera(e)).toBe(false);
    expect(e.setCameraOptions).not.toHaveBeenCalled();
    expect(e.setCamera).not.toHaveBeenCalled();
  });

  it("does not fit a squeezed 730×1 viewport (the real crash: padding exceeds the height)", () => {
    const e = fakeEditor(730, 1);
    expect(fitBoardCamera(e)).toBe(false);
    expect(e.setCameraOptions).not.toHaveBeenCalled();
  });

  it("fits the page width, starting at the top of the 1000×3000 page", () => {
    const e = fakeEditor(800, 600);
    expect(fitBoardCamera(e)).toBe(true);
    expect(e.setCameraOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          bounds: { x: 0, y: 0, w: 1000, h: 3000 }, initialZoom: "fit-x", baseZoom: "fit-x", origin: { x: 0.5, y: 0 },
        }),
      }),
    );
    expect(e.setCamera).toHaveBeenCalledWith({ x: 0, y: 0, z: 1 }, { reset: true });
  });
});

// Page point → screen point for a tldraw camera.
const toScreen = (c: { x: number; y: number; z: number } | null, px: number, py: number) => ({ x: (px + c!.x) * c!.z, y: (py + c!.y) * c!.z });

describe("cameraFor", () => {
  const vp = { w: 1000, h: 700 };
  const availW = vp.w - INSETS.left - INSETS.right;
  const availH = vp.h - INSETS.top - INSETS.bottom;

  it("zooms a narrow line of working up to a readable scale, not the whole page width", () => {
    const c = cameraFor(vp, { x: 20, y: 20, w: 300, h: 60 })!;
    expect(c.z).toBeGreaterThan(availW / 1000);
    expect(c.z).toBeLessThanOrEqual(MAX_ZOOM);
    // the item is fully on screen and clear of the menus/toolbar
    const tl = toScreen(c, 20, 20), br = toScreen(c, 320, 80);
    expect(tl.x).toBeGreaterThanOrEqual(INSETS.left - 0.01);
    expect(tl.y).toBeGreaterThanOrEqual(INSETS.top - 0.01);
    expect(br.x).toBeLessThanOrEqual(vp.w - INSETS.right + 0.01);
    expect(br.y).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.01);
  });

  it("does nothing in a squeezed viewport (would crash tldraw with an Infinity camera)", () => {
    expect(cameraFor({ w: 730, h: 1 }, { x: 20, y: 20, w: 100, h: 40 })).toBeNull();
    expect(cameraFor({ w: 0, h: 0 }, { x: 20, y: 20, w: 100, h: 40 })).toBeNull();
  });

  it("never zooms beyond MAX_ZOOM on a big screen", () => {
    expect(cameraFor({ w: 3000, h: 2000 }, { x: 20, y: 20, w: 100, h: 40 })!.z).toBe(MAX_ZOOM);
  });

  it("never shows less than the full width for a page-wide item", () => {
    const c = cameraFor(vp, { x: 20, y: 400, w: 960, h: 100 })!;
    expect(c.z).toBeCloseTo(availW / 1000, 5);
  });

  it("keeps the view inside the page (left edge at x=0 rather than empty space)", () => {
    const c = cameraFor(vp, { x: 20, y: 20, w: 100, h: 40 });
    expect(toScreen(c, 0, 0).x).toBeCloseTo(INSETS.left, 5);
    expect(toScreen(c, 0, 0).y).toBeCloseTo(INSETS.top, 5);
  });

  it("a tall stack of working shows its newest line at the bottom, like paper scrolling up", () => {
    const region = { x: 20, y: 800, w: 500, h: 1200 };
    const anchor = { x: 20, y: 1940, w: 400, h: 60 };
    const c = cameraFor(vp, region, anchor);
    const br = toScreen(c, 420, 2000);
    expect(br.y).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.01);
    expect(br.y).toBeGreaterThan(vp.h - INSETS.bottom - 60);
  });

  it("near the top of the page the view starts at the page top: the first line is never cut by the top bar", () => {
    // the question at y=20, then a derivation under it is followed (the real case: q sat half under the toolbar)
    const c = cameraFor(vp, { x: 20, y: 104, w: 548, h: 314 }, { x: 20, y: 169, w: 213, h: 67 });
    expect(toScreen(c, 0, 0).y).toBeCloseTo(INSETS.top, 5);
    expect(toScreen(c, 0, 418).y).toBeLessThanOrEqual(vp.h - INSETS.bottom + 0.01);
  });

  it("a short region is centred vertically in the clear area", () => {
    const c = cameraFor(vp, { x: 300, y: 1500, w: 400, h: 100 });
    const mid = toScreen(c, 500, 1550);
    expect(mid.y).toBeCloseTo(INSETS.top + availH / 2, 5);
    expect(mid.x).toBeCloseTo(INSETS.left + availW / 2, 5);
  });

  it("shrinks to fit a tall anchor in a short viewport", () => {
    const c = cameraFor({ w: 1000, h: 400 }, { x: 20, y: 100, w: 360, h: 240 })!;
    expect(240 * c.z).toBeLessThanOrEqual(400 - INSETS.top - INSETS.bottom);
  });
});

describe("followPaused", () => {
  it("pauses following for ~6 s after the student touched the board", () => {
    expect(followPaused(undefined, 1000)).toBe(false);
    expect(followPaused(10_000, 12_000)).toBe(true);
    expect(followPaused(10_000, 16_100)).toBe(false);
  });
});

describe("inClearView", () => {
  // viewport in page units at zoom 2: the bars cover INSETS / 2 page units of it
  const vp = { x: 0, y: 100, w: 500, h: 400 };

  it("an item well inside the screen is in view", () => {
    expect(inClearView(vp, 2, { x: 100, y: 200, w: 200, h: 40 })).toBe(true);
  });

  it("an item tucked under the top bar or bottom toolbar is not (the camera pans to it)", () => {
    expect(inClearView(vp, 2, { x: 100, y: 105, w: 200, h: 30 })).toBe(false);
    expect(inClearView(vp, 2, { x: 100, y: 480, w: 200, h: 15 })).toBe(false);
  });

  it("an item off screen is not", () => {
    expect(inClearView(vp, 2, { x: 100, y: 900, w: 200, h: 40 })).toBe(false);
  });
});
