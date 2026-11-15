"use client";

/**
 * Lightweight responsive SVG line chart with a crosshair + tooltip hover layer (pointer and
 * arrow keys). Theme-correct: chrome uses design tokens, series carry their own colour + dash.
 */
import React, { useId, useMemo, useState } from "react";
import { fmtNum } from "./format";
import { nearestIndex } from "./stats";
import { SeriesSwatch, niceTicks, useElementWidth } from "./kit";
import { RichText } from "../../math/MathTex";

export interface ChartSeries {
  name: string;
  color: string;
  dash?: string;
  y: (number | null)[];
  /** Hide this series from tooltip rows (still drawn). */
  quiet?: boolean;
}

export interface ChartMarker {
  x: number;
  y: number;
  color: string;
  label?: string;
}

export interface LineChartProps {
  x: number[];
  series: ChartSeries[];
  height?: number;
  compact?: boolean;
  xLabel?: string;
  hRules?: { y: number; label?: string }[];
  vRules?: { x: number; label?: string }[];
  markers?: ChartMarker[];
  /** Fill between series[0] and 0: `pos` wash above zero, `neg` wash below. */
  diverging?: { pos: string; neg: string };
  /** Light area wash under a single series. */
  wash?: boolean;
  includeZero?: boolean;
  legend?: boolean;
  ariaLabel: string;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
}

function buildPath(xs: number[], ys: (number | null)[], sx: (v: number) => number, sy: (v: number) => number) {
  let d = "";
  let pen = false;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const v = ys[i];
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(xs[i]).toFixed(1)} ${sy(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

export function LineChart({
  x,
  series,
  height = 260,
  compact = false,
  xLabel,
  hRules = [],
  vRules = [],
  markers = [],
  diverging,
  wash = false,
  includeZero = false,
  legend = false,
  ariaLabel,
  formatX = (v) => fmtNum(v),
  formatY = (v) => fmtNum(v),
}: LineChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");

  const pad = compact
    ? { t: 8, r: 10, b: 20, l: 40 }
    : { t: 14, r: 18, b: xLabel ? 40 : 26, l: 54 };
  const W = Math.max(0, width);
  const H = height;
  const plotW = Math.max(10, W - pad.l - pad.r);
  const plotH = Math.max(10, H - pad.t - pad.b);

  const geom = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series)
      for (const v of s.y)
        if (v !== null && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
    for (const r of hRules) {
      lo = Math.min(lo, r.y);
      hi = Math.max(hi, r.y);
    }
    if (includeZero || diverging) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    if (lo === hi) {
      const d = Math.abs(lo) * 0.1 || 1;
      lo -= d;
      hi += d;
    }
    const padY = (hi - lo) * 0.06;
    let yMin = lo - padY;
    let yMax = hi + padY;
    const ticks = niceTicks(yMin, yMax, compact ? 3 : 5);
    if (ticks.length) {
      yMin = Math.min(yMin, ticks[0]);
      yMax = Math.max(yMax, ticks[ticks.length - 1]);
    }
    const xMin = x.length ? Math.min(x[0], x[x.length - 1]) : 0;
    const xMax = x.length ? Math.max(x[0], x[x.length - 1]) : 1;
    const xTicks = niceTicks(xMin, xMax, compact ? 4 : Math.max(3, Math.min(8, Math.floor(plotW / 90))));
    return { yMin, yMax, ticks, xMin, xMax, xTicks };
  }, [series, hRules, includeZero, diverging, x, compact, plotW]);

  const sx = (v: number) => pad.l + ((v - geom.xMin) / (geom.xMax - geom.xMin || 1)) * plotW;
  const sy = (v: number) => pad.t + plotH - ((v - geom.yMin) / (geom.yMax - geom.yMin || 1)) * plotH;
  const zeroY = sy(Math.min(Math.max(0, geom.yMin), geom.yMax));

  const hoverIdx = hover !== null && hover < x.length ? hover : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const xv = geom.xMin + (px / (r.width || 1)) * (geom.xMax - geom.xMin);
    setHover(nearestIndex(x, xv));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (!x.length) return;
    const stepN = e.shiftKey ? Math.max(1, Math.round(x.length / 10)) : 1;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setHover((h) => Math.min(x.length - 1, (h ?? -1) + stepN));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setHover((h) => Math.max(0, (h ?? x.length) - stepN));
    } else if (e.key === "Escape") setHover(null);
  };

  const tipRows =
    hoverIdx === null
      ? []
      : series
          .map((s, i) => ({ s, i, v: s.y[hoverIdx] }))
          .filter((r) => !r.s.quiet && r.v !== null && r.v !== undefined && Number.isFinite(r.v));
  const tipLeft = hoverIdx === null ? 0 : sx(x[hoverIdx]);
  const flip = tipLeft > W * 0.62;

  return (
    <div className="w-full">
      {legend && series.length >= 2 && (
        <ul className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Legend">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
              <SeriesSwatch color={s.color} dash={s.dash} />
              <RichText text={s.name} />
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative w-full" style={{ height: H }}>
        {W > 0 && (
          <svg
            width={W}
            height={H}
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            className="apple-focus block rounded-lg"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <defs>
              <clipPath id={`clip-${uid}`}>
                <rect x={pad.l} y={pad.t} width={plotW} height={plotH} />
              </clipPath>
              {diverging && (
                <>
                  <clipPath id={`pos-${uid}`}>
                    <rect x={pad.l} y={pad.t} width={plotW} height={Math.max(0, zeroY - pad.t)} />
                  </clipPath>
                  <clipPath id={`neg-${uid}`}>
                    <rect x={pad.l} y={zeroY} width={plotW} height={Math.max(0, pad.t + plotH - zeroY)} />
                  </clipPath>
                </>
              )}
            </defs>

            {/* Grid + y ticks */}
            {geom.ticks.map((t) => (
              <g key={`y${t}`}>
                <line
                  x1={pad.l}
                  x2={pad.l + plotW}
                  y1={sy(t)}
                  y2={sy(t)}
                  stroke="var(--border-subtle)"
                  strokeWidth={1}
                />
                <text
                  x={pad.l - 8}
                  y={sy(t) + 3.5}
                  textAnchor="end"
                  fontSize={compact ? 9 : 10}
                  fill="var(--text-muted)"
                >
                  {formatY(t)}
                </text>
              </g>
            ))}
            {/* x ticks */}
            {geom.xTicks.map((t) => (
              <text
                key={`x${t}`}
                x={sx(t)}
                y={pad.t + plotH + (compact ? 13 : 16)}
                textAnchor="middle"
                fontSize={compact ? 9 : 10}
                fill="var(--text-muted)"
              >
                {formatX(t)}
              </text>
            ))}
            <line
              x1={pad.l}
              x2={pad.l + plotW}
              y1={pad.t + plotH}
              y2={pad.t + plotH}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            {xLabel && !compact && (
              <text
                x={pad.l + plotW / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-secondary)"
              >
                {xLabel}
              </text>
            )}

            {/* Reference rules */}
            {hRules.map((r) => (
              <g key={`h${r.y}`}>
                <line
                  x1={pad.l}
                  x2={pad.l + plotW}
                  y1={sy(r.y)}
                  y2={sy(r.y)}
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  opacity={0.7}
                />
                {r.label && (
                  <text x={pad.l + plotW - 4} y={sy(r.y) - 4} textAnchor="end" fontSize={9.5} fill="var(--text-muted)">
                    {r.label}
                  </text>
                )}
              </g>
            ))}
            {vRules.map((r, i) => (
              <g key={`v${i}`}>
                <line
                  x1={sx(r.x)}
                  x2={sx(r.x)}
                  y1={pad.t}
                  y2={pad.t + plotH}
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.8}
                />
                {r.label && (
                  <text x={sx(r.x) + 4} y={pad.t + 10} fontSize={9.5} fill="var(--text-muted)">
                    {r.label}
                  </text>
                )}
              </g>
            ))}

            {/* Fills */}
            <g clipPath={`url(#clip-${uid})`}>
              {diverging && series[0] && (() => {
                const line = buildPath(x, series[0].y, sx, sy);
                if (!line) return null;
                const area = `${line}L${sx(geom.xMax).toFixed(1)} ${zeroY.toFixed(1)}L${sx(geom.xMin).toFixed(1)} ${zeroY.toFixed(1)}Z`;
                return (
                  <g className="st-reveal-x">
                    <path d={area} fill={diverging.pos} opacity={0.16} clipPath={`url(#pos-${uid})`} />
                    <path d={area} fill={diverging.neg} opacity={0.16} clipPath={`url(#neg-${uid})`} />
                  </g>
                );
              })()}
              {wash && series[0] && (() => {
                const line = buildPath(x, series[0].y, sx, sy);
                if (!line) return null;
                const base = pad.t + plotH;
                const area = `${line}L${sx(geom.xMax).toFixed(1)} ${base}L${sx(geom.xMin).toFixed(1)} ${base}Z`;
                return <path className="st-reveal-x" d={area} fill={series[0].color} opacity={0.1} />;
              })()}

              {/* Lines */}
              <g className="st-reveal-x">
                {series.map((s) => (
                  <path
                    key={s.name}
                    d={buildPath(x, s.y, sx, sy)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            </g>

            {/* Markers (surface ring keeps them legible over lines) */}
            {markers.map((m, i) => (
              <g key={`m${i}`}>
                <circle cx={sx(m.x)} cy={sy(m.y)} r={4.5} fill={m.color} stroke="var(--bg-surface)" strokeWidth={2} />
                {m.label && (
                  <text
                    x={sx(m.x)}
                    y={sy(m.y) + (sy(m.y) < pad.t + 14 ? 15 : -8)}
                    textAnchor={sx(m.x) > pad.l + plotW - 30 ? "end" : sx(m.x) < pad.l + 30 ? "start" : "middle"}
                    fontSize={9.5}
                    fontWeight={600}
                    fill="var(--text-secondary)"
                  >
                    {m.label}
                  </text>
                )}
              </g>
            ))}

            {/* Crosshair */}
            {hoverIdx !== null && (
              <g pointerEvents="none">
                <line
                  x1={sx(x[hoverIdx])}
                  x2={sx(x[hoverIdx])}
                  y1={pad.t}
                  y2={pad.t + plotH}
                  stroke="var(--text-muted)"
                  strokeWidth={1}
                />
                {series.map((s) => {
                  const v = s.y[hoverIdx];
                  if (v === null || v === undefined || !Number.isFinite(v)) return null;
                  return (
                    <circle
                      key={s.name}
                      cx={sx(x[hoverIdx])}
                      cy={sy(v)}
                      r={4}
                      fill={s.color}
                      stroke="var(--bg-surface)"
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}

            {/* Hit area */}
            <rect
              x={pad.l}
              y={0}
              width={plotW}
              height={H}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}

        {hoverIdx !== null && W > 0 && (
          <div
            className="apple-glass-elevated pointer-events-none absolute z-10 min-w-[8.5rem] rounded-xl border px-3 py-2 text-[11px]"
            style={{
              top: pad.t,
              left: flip ? undefined : Math.min(tipLeft + 12, W - 140),
              right: flip ? Math.max(0, W - tipLeft + 12) : undefined,
            }}
          >
            <p className="mb-1 font-medium text-[var(--text-muted)]">
              {xLabel ? `${xLabel}: ` : "x = "}
              <span className="font-mono text-[var(--text-primary)]">{fmtNum(x[hoverIdx], 4)}</span>
            </p>
            {tipRows.map(({ s, v }) => (
              <p key={s.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <SeriesSwatch color={s.color} dash={s.dash} width={16} />
                  <RichText className="max-w-[10rem] truncate" text={s.name} />
                </span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">{fmtNum(v as number, 4)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
