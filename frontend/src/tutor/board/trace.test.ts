import { describe, expect, it } from "vitest";
import { along, linePath, pathLength, plotPath, travelMs } from "./trace";

describe("linePath (a written line)", () => {
  it("runs left → right under the line, from its start to its end", () => {
    const [row] = linePath({ x: 20, y: 100, w: 300, h: 40 });
    expect(row[0].x).toBe(20);
    expect(row[row.length - 1].x).toBe(320);
    expect(row[0].y).toBe(row[row.length - 1].y);
    expect(row[0].y).toBeGreaterThan(130); // near the bottom (underlining), not over the middle of the text
    expect(row[0].y).toBeLessThanOrEqual(140);
  });

  it("a wrapped text item is read row by row, top to bottom", () => {
    const rows = linePath({ x: 0, y: 0, w: 200, h: 66 }, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0][0].y).toBeLessThan(33);
    expect(rows[1][0].y).toBeGreaterThan(33);
    expect(rows.every((r) => r[0].x === 0 && r[r.length - 1].x === 200)).toBe(true);
  });

  it("`at` places the stroke within each row (0.5 = through the middle, for the marker)", () => {
    expect(linePath({ x: 0, y: 10, w: 100, h: 40 }, 1, 0.5)[0][0].y).toBe(30);
  });
});

describe("plotPath (a function plot)", () => {
  // function-plot's cartesian margins: left 40, right 20, top 20 (40 with a title), bottom 20
  const p = { x: 100, y: 200, w: 360, h: 240, xMin: 0, xMax: 2, label: "", points: [] as number[][] };

  it("follows the curve left → right in page coordinates, inside the plot area", () => {
    const [curve] = plotPath({ ...p, expr: "x" }, [0, 2], (x) => x);
    expect(curve[0]).toEqual({ x: 140, y: 420 }); // (0,0) bottom-left of the inner area
    expect(curve[curve.length - 1]).toEqual({ x: 440, y: 220 }); // (2,2) top-right
    expect(curve.every((pt, i) => !i || pt.x > curve[i - 1].x)).toBe(true);
  });

  it("a title pushes the plot area down", () => {
    const [curve] = plotPath({ ...p, label: "y = x", expr: "x" }, [0, 2], (x) => x);
    expect(curve[curve.length - 1].y).toBe(240);
  });

  it("follows a parabola: down then up", () => {
    const [curve] = plotPath({ ...p, xMin: -1, xMax: 1, expr: "x^2" }, [0, 1], (x) => x * x);
    const ys = curve.map((pt) => pt.y);
    const low = ys.indexOf(Math.max(...ys)); // screen y grows downward
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(ys.length - 1);
    expect(curve[low].x).toBeCloseTo(140 + 150, 0);
  });

  it("breaks the trace where the function is undefined", () => {
    const strokes = plotPath({ ...p, xMin: -1, xMax: 1, expr: "1/x" }, [-10, 10], (x) => (x === 0 ? NaN : 1 / x));
    expect(strokes.length).toBe(2);
  });

  it("traces data points in order", () => {
    const [line] = plotPath({ ...p, expr: "", points: [[0, 0], [1, 2], [2, 0]] }, [0, 2]);
    expect(line).toEqual([{ x: 140, y: 420 }, { x: 290, y: 220 }, { x: 440, y: 420 }]);
  });
});

describe("travelling along a path", () => {
  const path = [[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 50 }, { x: 100, y: 50 }]];

  it("measures only the strokes (the laser jumps between them)", () => {
    expect(pathLength(path)).toBe(200);
  });

  it("finds the point a fraction of the way along", () => {
    expect(along(path, 0)).toEqual({ x: 0, y: 0 });
    expect(along(path, 0.25)).toEqual({ x: 50, y: 0 });
    expect(along(path, 0.75)).toEqual({ x: 50, y: 50 });
    expect(along(path, 1)).toEqual({ x: 100, y: 50 });
  });

  it("a single point (nothing to travel) stays put", () => {
    expect(along([[{ x: 5, y: 6 }]], 0.5)).toEqual({ x: 5, y: 6 });
  });

  it("takes about 1–1.5 s, longer for longer lines", () => {
    expect(travelMs(0)).toBe(1000);
    expect(travelMs(200)).toBeLessThan(travelMs(560));
    expect(travelMs(5000)).toBe(1500);
  });
});
