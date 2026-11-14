import katex from "katex";
import { useLayoutEffect, useRef } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLShape } from "tldraw";
import type {} from "../toShapes"; // custom shape type augmentation

export type MathShape = TLShape<"math">;

const FONT_PX = 28;
const PAD = 6;
const render = (latex: string, output: "html" | "mathml") =>
  katex.renderToString(`\\displaystyle ${latex}`, { throwOnError: false, output });

const sizes = new Map<string, { w: number; h: number }>();
/** Natural rendered size of a formula in page px (browser only, cached). */
export function measureMath(latex: string): { w: number; h: number } {
  let s = sizes.get(latex);
  if (!s) {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:nowrap;font-size:${FONT_PX}px`;
    el.innerHTML = render(latex, "html");
    document.body.appendChild(el);
    s = { w: Math.ceil(el.offsetWidth) + 2 * PAD, h: Math.ceil(el.offsetHeight) + 2 * PAD };
    el.remove();
    // Metrics taken with fallback fonts are wrong; only cache once KaTeX's fonts are in.
    if (document.fonts.check(`${FONT_PX}px KaTeX_Main`) && document.fonts.check(`${FONT_PX}px KaTeX_Math`)) sizes.set(latex, s);
  }
  return s;
}

// Shrinks the formula when the layout gave it a smaller box than its natural size.
const fontFor = (shape: MathShape) => {
  const n = measureMath(shape.props.latex);
  return FONT_PX * Math.min(1, shape.props.w / n.w, shape.props.h / n.h);
};

/** Starts loading KaTeX fonts so the first formulas are measured with real metrics. */
export const preloadMathFonts = () =>
  Promise.all(["KaTeX_Main", "KaTeX_Math", "KaTeX_Size1", "KaTeX_Size2"].map((f) => document.fonts.load(`${FONT_PX}px ${f}`))).catch(() => {});

/** Renders at natural size, then scales down to fit the box (layout may have used stale metrics). */
function MathView({ shape }: { shape: MathShape }) {
  const inner = useRef<HTMLSpanElement>(null);
  const { w, h, latex } = shape.props;
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
      <span ref={inner} style={{ display: "inline-block", transformOrigin: "left center" }} dangerouslySetInnerHTML={{ __html: render(latex, "html") }} />
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

  getIndicatorPath(shape: MathShape) {
    const p = new Path2D();
    p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }

  // Exports use MathML: the browser renders it natively, no KaTeX fonts or CSS needed inside the SVG.
  override toSvg(shape: MathShape) {
    return (
      <foreignObject width={shape.props.w} height={shape.props.h}>
        <div
          // @ts-expect-error xmlns is required inside foreignObject but missing from React's div props
          xmlns="http://www.w3.org/1999/xhtml"
          style={{ display: "flex", alignItems: "center", height: "100%", padding: PAD, boxSizing: "border-box", whiteSpace: "nowrap", fontSize: fontFor(shape), color: "#1d1d1d" }}
          dangerouslySetInnerHTML={{ __html: render(shape.props.latex, "mathml") }}
        />
      </foreignObject>
    );
  }
}
