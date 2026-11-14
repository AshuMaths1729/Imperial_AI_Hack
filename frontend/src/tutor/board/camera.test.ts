import { describe, expect, it, vi } from "vitest";
import { fitBoardCamera, type CameraEditor } from "./camera";

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
    fitBoardCamera(e, 4000);
    expect(e.updateViewportScreenBounds).toHaveBeenCalledWith(e.getContainer());
  });

  it("does not fit while the viewport has no size (fit-max would divide by zero)", () => {
    const e = fakeEditor(0, 0);
    expect(fitBoardCamera(e, 4000)).toBe(false);
    expect(e.setCameraOptions).not.toHaveBeenCalled();
    expect(e.setCamera).not.toHaveBeenCalled();
  });

  it("does not fit a squeezed 730×1 viewport (the real crash: padding exceeds the height)", () => {
    const e = fakeEditor(730, 1);
    expect(fitBoardCamera(e, 4000)).toBe(false);
    expect(e.setCameraOptions).not.toHaveBeenCalled();
  });

  it("fits the whole board once the viewport has size", () => {
    const e = fakeEditor(800, 600);
    expect(fitBoardCamera(e, 4000)).toBe(true);
    expect(e.setCameraOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({ bounds: { x: 0, y: 0, w: 4000, h: 4000 }, initialZoom: "fit-max" }),
      }),
    );
    expect(e.setCamera).toHaveBeenCalledWith({ x: 0, y: 0, z: 1 }, { reset: true });
  });
});
