import { describe, expect, it } from "vitest";
import { toIntrinsic } from "./ScreenCircle";

describe("screen circle", () => {
  it("maps element-px region to intrinsic video px", () => {
    expect(toIntrinsic({ x: 320, y: 180, w: 160, h: 90 }, { w: 640, h: 360 }, { w: 1920, h: 1080 })).toEqual({
      x: 960,
      y: 540,
      w: 480,
      h: 270,
    });
  });

  it("accounts for letterboxing and clamps to the frame", () => {
    // 4:3 video (1200x900) letterboxed in a 1000x500 element: drawn 667x500 starting at x≈166.7
    const r = toIntrinsic({ x: 100, y: 0, w: 400, h: 250 }, { w: 1000, h: 500 }, { w: 1200, h: 900 });
    expect(r.x).toBe(0); // the part left of the picture is clamped away
    expect(r.y).toBe(0);
    expect(r.w).toBe(600); // (500 - 166.67) * 1.8
    expect(r.h).toBe(450);
  });
});
