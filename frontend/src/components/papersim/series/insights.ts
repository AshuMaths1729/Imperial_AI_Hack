/** Plain-language sentences generated from computed statistics (never invented numbers). */
import { atX, fmtNum, fmtPct, withUnit, type AxisLabel } from "./format";
import type { Comparison, SeriesStats, Shape } from "./stats";

export const SHAPE_LABEL: Record<Shape, string> = {
  constant: "Constant",
  increasing: "Monotonic rise",
  decreasing: "Monotonic decay",
  peak: "Rises, then falls",
  valley: "Dips, then recovers",
  oscillating: "Oscillating",
  irregular: "Irregular",
};

export function seriesInsights(name: string, s: SeriesStats, xAxis: AxisLabel): string[] {
  const out: string[] = [];
  const span = `${fmtNum(s.x0)}–${withUnit(fmtNum(s.x1), xAxis.unit)}`;
  if (s.shape === "constant") {
    out.push(`${name} stays flat at ${fmtNum(s.initial)} across ${xAxis.name} ${span}.`);
    return out;
  }
  const verb = s.net > 0 ? "rises" : s.net < 0 ? "falls" : "ends where it started,";
  const pct = s.netPct !== null && s.net !== 0 && Math.abs(s.netPct) < 50 ? ` (${fmtPct(s.netPct)})` : "";
  out.push(
    s.net === 0
      ? `${name} ends where it started (${fmtNum(s.initial)}) over ${xAxis.name} ${span}.`
      : `${name} ${verb} from ${fmtNum(s.initial)} to ${fmtNum(s.final)}${pct} over ${xAxis.name} ${span}.`,
  );
  if (s.shape === "peak") out.push(`It peaks at ${fmtNum(s.max)} when ${atX(xAxis, s.maxX)}.`);
  if (s.shape === "valley") out.push(`It bottoms out at ${fmtNum(s.min)} when ${atX(xAxis, s.minX)}.`);
  if (s.shape === "oscillating") {
    const cycles = Math.max(s.peaks.length, s.troughs.length);
    out.push(
      `It oscillates through ${cycles} cycle${cycles === 1 ? "" : "s"}${
        s.period !== null ? `, one roughly every ${withUnit(fmtNum(s.period), xAxis.unit)}` : ""
      }${s.zeroCrossings ? `, crossing zero ${s.zeroCrossings} time${s.zeroCrossings === 1 ? "" : "s"}` : ""}.`,
    );
  }
  if (s.fit) {
    const half = withUnit(fmtNum(s.fit.half), xAxis.unit);
    if (s.fit.basis === "envelope")
      out.push(`The swing amplitude halves about every ${half} (envelope fit, R² = ${s.fit.r2.toFixed(2)}).`);
    else if (s.fit.kind === "decay")
      out.push(
        `Its distance to ${fmtNum(s.fit.c)} halves about every ${half}: close to exponential (R² = ${s.fit.r2.toFixed(3)}).`,
      );
    else out.push(`It grows close to exponentially, doubling about every ${half} (R² = ${s.fit.r2.toFixed(3)}).`);
  }
  if (s.stillChanging) out.push("It is still changing at the end of the window, so the final value is not an equilibrium.");
  return out;
}

export function comparisonInsights(a: string, b: string, c: Comparison, xAxis: AxisLabel): string[] {
  const out: string[] = [];
  const end = atX(xAxis, c.x[c.x.length - 1]);
  if (c.finalGap === 0) out.push(`${a} and ${b} finish level at ${end}.`);
  else {
    const higher = c.finalGap > 0;
    // Relative gap only when B's final value is a meaningful base (not ~0) and the figure is readable.
    const base = Math.max(Math.abs(c.finalA), Math.abs(c.finalB));
    const showPct =
      c.finalGapPct !== null && Math.abs(c.finalB) >= 0.1 * base && Math.abs(c.finalGapPct) < 10;
    const pct = showPct
      ? ` (${fmtPct(Math.abs(c.finalGapPct as number)).replace("+", "")} ${higher ? "more" : "less"})`
      : "";
    out.push(`${a} ends ${fmtNum(Math.abs(c.finalGap))} ${higher ? "higher" : "lower"} than ${b} at ${end}${pct}.`);
  }
  if (c.maxAbsDiff > 0)
    out.push(`The two diverge most at ${atX(xAxis, c.maxAbsDiffX)}, where the gap is ${fmtNum(c.maxAbsDiff)}.`);
  if (c.crossings.length === 0) {
    out.push(
      c.aAboveFrac >= 0.5
        ? `${a} stays above ${b} over the whole range.`
        : `${a} stays below ${b} over the whole range.`,
    );
  } else {
    out.push(
      `The curves cross ${c.crossings.length} time${c.crossings.length === 1 ? "" : "s"} (first at ${atX(
        xAxis,
        c.crossings[0],
      )}); ${a} is on top for ${Math.round(c.aAboveFrac * 100)}% of the range.`,
    );
  }
  if (c.r !== null) {
    if (c.r > 0.9) out.push(`Their shapes move together closely (correlation r = ${c.r.toFixed(2)}).`);
    else if (c.r < -0.5) out.push(`They tend to move in opposite directions (r = ${c.r.toFixed(2)}).`);
    else out.push(`Their shapes are only loosely related (r = ${c.r.toFixed(2)}).`);
  }
  return out;
}
