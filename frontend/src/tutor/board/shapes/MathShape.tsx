import katex from "katex";
import { useLayoutEffect, useRef } from "react";
import { BaseBoxShapeUtil, DefaultFontFaces, HTMLContainer, T, type Editor, type RecordProps, type TLShape } from "tldraw";
import type {} from "../toShapes"; // custom shape type augmentation

export type MathShape = TLShape<"math">;

const FONT_PX = 22; // ×1.21 (KaTeX) ≈ 27 px: a little larger than the tutor's 24 px handwriting
const PAD = 6;
const KATEX_EM = 1.21; // KaTeX's HTML is set at 1.21em; the MathML export matches it
const render = (latex: string, output: "html" | "mathml") =>
  katex.renderToString(`\\displaystyle ${latex}`, { throwOnError: false, output });

// Board maths is written in the tutor's handwriting (tldraw's "draw" font, Shantell Sans) with KaTeX doing the layout
// (fractions, superscripts); glyphs the handwriting font lacks (Greek, arrows, big delimiters) fall back to KaTeX's.
const HAND = DefaultFontFaces.tldraw_draw.normal.normal;
export const HAND_FONTS = {
  main: `${HAND.family}, KaTeX_Main, "Times New Roman", serif`,
  math: `${HAND.family}, KaTeX_Math, KaTeX_Main, serif`,
};
// `.tw-ink-outline` is a stroked copy over the formula, shown only while it is being written (outline leads, ink follows).
export const HAND_CSS = `
.tw-hand .katex { font-family: ${HAND_FONTS.main}; }
.tw-hand .katex .mathnormal, .tw-hand .katex .boldsymbol { font-family: ${HAND_FONTS.math}; font-style: normal; }
.tw-hand .katex .mathit, .tw-hand .katex .mathrm, .tw-hand .katex .textrm, .tw-hand .katex .mathbf, .tw-hand .katex .textbf, .tw-hand .katex .mainrm { font-family: ${HAND_FONTS.main}; font-style: normal; }
.tw-hand .tw-ink-outline { position: absolute; left: 0; top: 0; visibility: hidden; color: transparent; -webkit-text-stroke: 0.7px var(--tl-color-text, #1d1d1d); }
`;
let handCss: HTMLStyleElement | undefined;
const ensureHandCss = () => {
  if (!handCss?.isConnected) handCss = document.head.appendChild(Object.assign(document.createElement("style"), { textContent: HAND_CSS }));
};
const handFontLoaded = () => {
  let ok = false;
  document.fonts.forEach((f) => { ok ||= f.family.replace(/["']/g, "") === HAND.family && f.status === "loaded"; });
  return ok;
};

/** Export markup: native MathML (no KaTeX CSS needed in the SVG) in the same handwriting font (embedded via getFontFaces). */
export const exportMathml = (latex: string) =>
  `<style>math, math * { font-family: ${HAND_FONTS.math}; font-style: normal; text-transform: none; }</style>${render(latex, "mathml")}`;

const sizes = new Map<string, { w: number; h: number }>();
/** Natural rendered size of a formula in page px (browser only, cached). */
export function measureMath(latex: string): { w: number; h: number } {
  let s = sizes.get(latex);
  if (!s) {
    ensureHandCss();
    const el = document.createElement("div");
    el.className = "tw-hand";
    el.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;font-size:${FONT_PX}px`;
    el.innerHTML = render(latex, "html");
    document.body.appendChild(el);
    s = { w: Math.ceil(el.offsetWidth) + 2 * PAD, h: Math.ceil(el.offsetHeight) + 2 * PAD };
    el.remove();
    // Metrics taken with fallback fonts are wrong; only cache once KaTeX's fonts are in.
    if (handFontLoaded() && document.fonts.check(`${FONT_PX}px KaTeX_Main`) && document.fonts.check(`${FONT_PX}px KaTeX_Math`)) sizes.set(latex, s);
  }
  return s;
}

// Shrinks the formula when the layout gave it a smaller box than its natural size.
const fontFor = (shape: MathShape) => {
  const n = measureMath(shape.props.latex);
  return FONT_PX * Math.min(1, shape.props.w / n.w, shape.props.h / n.h);
};

/** Starts loading the handwriting and KaTeX fonts so the first formulas are measured with real metrics. */
export const preloadMathFonts = (editor: Editor) =>
  Promise.all([
    editor.fonts.ensureFontIsLoaded(HAND),
    ...["KaTeX_Main", "KaTeX_Math", "KaTeX_Size1", "KaTeX_Size2"].map((f) => document.fonts.load(`${FONT_PX}px ${f}`)),
  ]).catch(() => {});

/** Renders at natural size, then scales down to fit the box (layout may have used stale metrics). */
function MathView({ shape }: { shape: MathShape }) {
  const inner = useRef<HTMLSpanElement>(null);
  const { w, h, latex } = shape.props;
  const html = render(latex, "html");
  useLayoutEffect(ensureHandCss, []);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const fit = () => {
      const k = Math.min(1, (w - 2 * PAD) / el.offsetWidth, (h - 2 * PAD) / el.offsetHeight);
      el.style.transform = `scale(${k})`;
    };
    fit();
    document.fonts.ready.then(fit);
  }, [w, h, latex]);
  return (
    <HTMLContainer
      role="math"
      aria-label={latex}
      style={{ display: "flex", alignItems: "center", padding: PAD, whiteSpace: "nowrap", fontSize: FONT_PX, color: "var(--tl-color-text, #1d1d1d)" }}
    >
      <span ref={inner} className="tw-hand" style={{ display: "inline-block", position: "relative", transformOrigin: "left center" }}>
        <span className="tw-ink" style={{ display: "inline-block" }} dangerouslySetInnerHTML={{ __html: html }} />
        <span className="tw-ink-outline" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      </span>
    </HTMLContainer>
  );
}

export class MathShapeUtil extends BaseBoxShapeUtil<MathShape> {
  static override type = "math" as const;
  static override props: RecordProps<MathShape> = { w: T.number, h: T.number, latex: T.string };

  getDefaultProps(): MathShape["props"] {
    return { w: 200, h: 64, latex: "x" };
  }

  component(shape: MathShape) {
    return <MathView shape={shape} />;
  }

  override getFontFaces() {
    return [HAND];
  }

  getIndicatorPath(shape: MathShape) {
    const p = new Path2D();
    p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }

  override toSvg(shape: MathShape) {
    return (
      <foreignObject width={shape.props.w} height={shape.props.h}>
        <div
          // @ts-expect-error xmlns is required inside foreignObject but missing from React's div props
          xmlns="http://www.w3.org/1999/xhtml"
          style={{ display: "flex", alignItems: "center", height: "100%", padding: PAD, boxSizing: "border-box", whiteSpace: "nowrap", fontSize: fontFor(shape) * KATEX_EM, color: "#1d1d1d" }}
          dangerouslySetInnerHTML={{ __html: exportMathml(shape.props.latex) }}
        />
      </foreignObject>
    );
  }
}
