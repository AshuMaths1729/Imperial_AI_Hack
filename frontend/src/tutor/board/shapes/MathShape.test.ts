import { describe, expect, it } from "vitest";
import { HAND_CSS, HAND_FONTS, exportMathml } from "./MathShape";

describe("handwritten maths", () => {
  it("writes digits, letters and operators in the board's handwriting font, KaTeX fonts only as fallback", () => {
    expect(HAND_FONTS.main.startsWith("tldraw_draw,")).toBe(true);
    expect(HAND_FONTS.main).toContain("KaTeX_Main");
    expect(HAND_FONTS.math.startsWith("tldraw_draw,")).toBe(true);
    expect(HAND_FONTS.math).toContain("KaTeX_Math"); // Greek letters the handwriting font lacks
    for (const cls of [".katex ", ".mathnormal", ".mathit", ".mathrm", ".textrm", ".mathbf"]) expect(HAND_CSS).toContain(cls);
    expect(HAND_CSS).toContain("font-style: normal"); // handwritten variables are upright
  });

  it("keeps the export in the handwriting font too (snapshots look like the board)", () => {
    const html = exportMathml("rise = 9 - 1 = 8");
    expect(html).toContain("<math");
    expect(html).toContain(`font-family: ${HAND_FONTS.math}`);
    expect(html).toContain("text-transform: none"); // no auto-italic Unicode letters the handwriting font lacks
  });
});
