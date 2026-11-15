import functionPlot from "function-plot";
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLShape } from "tldraw";
import type {} from "../toShapes"; // custom shape type augmentation

export type PlotShape = TLShape<"plot">;
type PlotProps = PlotShape["props"];

export const evalAt = (expr: string, x: number): number => functionPlot.$eval.builtIn({ fn: expr }, "fn", { x });

/** y-range of the data with 10% padding. Throws if `expr` cannot be evaluated (used to reject bad plot ops). */
export function plotYDomain(p: Pick<PlotProps, "expr" | "points" | "xMin" | "xMax">): [number, number] {
  const ys = p.expr
    ? Array.from({ length: 201 }, (_, i) => evalAt(p.expr, p.xMin + ((p.xMax - p.xMin) * i) / 200))
    : p.points.map((pt) => pt[1]);
  const finite = ys.filter(Number.isFinite);
  if (!finite.length) throw new Error(`cannot plot ${JSON.stringify(p.expr)}: no finite values on [${p.xMin}, ${p.xMax}]`);
  const lo = Math.min(...finite), hi = Math.max(...finite);
  const pad = (hi - lo || 1) * 0.1;
  return [lo - pad, hi + pad];
}

const svgs = new Map<string, string>();
/** Static SVG markup for a plot (browser only, cached). Zoom is disabled: the board owns pan/zoom. */
function plotSvg(p: PlotProps): string {
  const key = JSON.stringify(p);
  let svg = svgs.get(key);
  if (svg === undefined) {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0";
    document.body.appendChild(el);
    try {
      functionPlot({
        target: el, width: p.w, height: p.h, grid: true, disableZoom: true, title: p.label || undefined,
        xAxis: { domain: [p.xMin, p.xMax] }, yAxis: { domain: plotYDomain(p) },
        data: [p.expr
          ? { fn: p.expr, graphType: "polyline", color: "#1d4ed8" }
          : { fnType: "points", points: p.points, graphType: "polyline", color: "#1d4ed8" }],
      });
      svg = el.querySelector("svg")?.outerHTML ?? "";
    } catch {
      svg = "";
    } finally {
      el.remove();
    }
    svgs.set(key, svg);
  }
  return svg;
}

export class PlotShapeUtil extends BaseBoxShapeUtil<PlotShape> {
  static override type = "plot" as const;
  static override props: RecordProps<PlotShape> = {
    w: T.number, h: T.number, expr: T.string, points: T.arrayOf(T.arrayOf(T.number)), xMin: T.number, xMax: T.number, label: T.string,
  };

  getDefaultProps(): PlotProps {
    return { w: 360, h: 240, expr: "x", points: [], xMin: -5, xMax: 5, label: "" };
  }

  component(shape: PlotShape) {
    const svg = plotSvg(shape.props);
    const name = shape.props.label || (shape.props.expr ? `y = ${shape.props.expr}` : "data points");
    return (
      <HTMLContainer role="img" aria-label={`Plot: ${name}`} style={{ background: "#fff", pointerEvents: "all" }}>
        {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <p style={{ padding: 12, color: "#b91c1c" }}>Could not plot {name}</p>}
      </HTMLContainer>
    );
  }

  getIndicatorPath(shape: PlotShape) {
    const p = new Path2D();
    p.rect(0, 0, shape.props.w, shape.props.h);
    return p;
  }

  override toSvg(shape: PlotShape) {
    return <g dangerouslySetInnerHTML={{ __html: plotSvg(shape.props) }} />;
  }
}
