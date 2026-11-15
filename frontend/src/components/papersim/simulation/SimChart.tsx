"use client";

import React, { useId } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { SeriesDoc, UIAnnotation } from "../../../types/scholartwin";
import { RichText } from "../../math/MathTex";
import {
  formatTick,
  formatValue,
  logTicks,
  nearestIndex,
  niceDomain,
  niceTicks,
  seriesColor,
  seriesDash,
  valueAt,
} from "./format";
import type { Frame } from "./hooks";
import { useElementWidth } from "./hooks";

/* ---------------- data model ---------------- */

export interface NamedSeries {
  name: string;
  y: number[];
}

/** A run frozen by "Pin run", drawn as a ghost behind the live curves. */
export interface PinnedRun {
  id: string;
  n: number;
  /** LaTeX of the params that produced it, e.g. "\gamma = 0.3,\ \eta = 0.1". */
  latex: string;
  params: Record<string, number>;
  x: number[];
  series: NamedSeries[];
}

/** One snapshot captured while sweeping a parameter (t = 0..1 along the sweep). */
export interface TrailRun {
  t: number;
  x: number[];
  series: NamedSeries[];
}

const toScale = (v: number, log: boolean) => (log ? (v > 0 ? Math.log10(v) : NaN) : v);

/**
 * Target frame for the chart: current data + the domain that fits every visible curve
 * (live, pinned and trail), in scale space when `log`.
 */
export function buildFrame(
  xs: number[],
  series: NamedSeries[],
  visible: (name: string) => boolean,
  log: boolean,
  extras: { x: number[]; series: NamedSeries[] }[]
): Frame {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  const take = (x: number[], ss: NamedSeries[]) => {
    for (const v of x) {
      if (!Number.isFinite(v)) continue;
      if (v < xmin) xmin = v;
      if (v > xmax) xmax = v;
    }
    for (const s of ss) {
      if (!visible(s.name)) continue;
      for (const raw of s.y) {
        const v = toScale(raw, log);
        if (!Number.isFinite(v)) continue;
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
  };
  take(xs, series);
  extras.forEach((e) => take(e.x, e.series));
  if (!Number.isFinite(xmin)) [xmin, xmax] = [0, 1];
  if (xmax === xmin) [xmin, xmax] = [xmin - 0.5, xmax + 0.5];
  let y0: number;
  let y1: number;
  if (!Number.isFinite(ymin)) [y0, y1] = [0, 1];
  else if (log) {
    const span = Math.max(ymax - ymin, 0.2);
    [y0, y1] = [ymin - span * 0.06, ymax + span * 0.06];
  } else [y0, y1] = niceDomain(ymin, ymax, 5);
  return { x: xs, ys: series.map((s) => s.y), x0: xmin, x1: xmax, y0, y1, log };
}

/* ---------------- geometry ---------------- */

interface Geo {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  sx: (x: number) => number;
  sy: (scaled: number) => number;
}

function linePath(xs: number[], ys: number[], g: Geo, log: boolean): string {
  let d = "";
  let pen = false;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const v = toScale(ys[i], log);
    if (!Number.isFinite(v) || !Number.isFinite(xs[i])) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${g.sx(xs[i]).toFixed(1)} ${g.sy(v).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function lastFinite(ys: number[], log: boolean): { i: number; v: number } | null {
  for (let i = ys.length - 1; i >= 0; i--) {
    const v = toScale(ys[i], log);
    if (Number.isFinite(v)) return { i, v };
  }
  return null;
}

/* ---------------- legend ---------------- */

export function Swatch({ idx, ghost = false }: { idx: number; ghost?: boolean }) {
  return (
    <svg width="22" height="10" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="5"
        x2="21"
        y2="5"
        strokeWidth={ghost ? 1.5 : 2.5}
        strokeLinecap="round"
        strokeDasharray={seriesDash(idx)}
        style={{ stroke: seriesColor(idx), opacity: ghost ? 0.45 : 1 }}
      />
    </svg>
  );
}

interface LegendProps {
  names: string[];
  docs: Map<string, SeriesDoc>;
  hidden: Set<string>;
  onToggle: (name: string) => void;
  onEmphasis: (name: string | null) => void;
}

/** Click to show/hide a series; hover/focus explains it (docs.series) and spotlights it. */
export function Legend({ names, docs, hidden, onToggle, onEmphasis }: LegendProps) {
  if (names.length < 2 && !docs.size) return null;
  return (
    // The row (not each chip) anchors the tooltips, so a tooltip never runs past the card edge
    // (a hidden one would otherwise still widen the scroll area on a phone).
    <div className="relative flex flex-wrap gap-1.5" role="group" aria-label="Series">
      {names.map((name, idx) => {
        const off = hidden.has(name);
        const doc = docs.get(name.trim().toLowerCase());
        return (
          <div key={name} className="group min-w-0 max-w-full">
            <button
              type="button"
              aria-pressed={!off}
              title={name}
              onClick={() => onToggle(name)}
              onMouseEnter={() => onEmphasis(name)}
              onMouseLeave={() => onEmphasis(null)}
              onFocus={() => onEmphasis(name)}
              onBlur={() => onEmphasis(null)}
              className={`apple-press apple-focus flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
                off
                  ? "border-dashed border-[var(--border-strong)] text-[var(--text-muted)] line-through"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
              }`}
            >
              <span className={`shrink-0 ${off ? "opacity-40" : ""}`}>
                <Swatch idx={idx} />
              </span>
              <RichText className="min-w-0 truncate" text={name} />
              {off ? (
                <EyeOff className="h-3 w-3 shrink-0" />
              ) : (
                <Eye className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />
              )}
            </button>
            {doc && (
              <div
                role="tooltip"
                className="apple-glass-elevated pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-[min(16rem,100%)] rounded-2xl border p-3 opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
              >
                <p className="text-xs font-semibold text-[var(--text-primary)]">{name}</p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-secondary)]">
                  <RichText text={doc.meaning} />
                </p>
                {doc.how_to_read && (
                  <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-muted)]">
                    <span className="font-semibold">How to read: </span>
                    <RichText text={doc.how_to_read} />
                  </p>
                )}
                <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">Click to {off ? "show" : "hide"}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- chart ---------------- */

interface SimChartProps {
  /** Frame on screen (tweened). */
  frame: Frame;
  /** Exact latest data (tooltips read from this, never from the tween). */
  exact: Frame;
  names: string[];
  xLabel: string;
  yLabel: string;
  hidden: Set<string>;
  emphasis: string | null;
  pins: PinnedRun[];
  highlightedPin: string | null;
  trail: TrailRun[];
  hoverX: number | null;
  onHoverX: (x: number | null) => void;
  callouts: UIAnnotation[];
  busy?: boolean;
}

export function SimChart({
  frame,
  exact,
  names,
  xLabel,
  yLabel,
  hidden,
  emphasis,
  pins,
  highlightedPin,
  trail,
  hoverX,
  onHoverX,
  callouts,
  busy,
}: SimChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(760);
  const clipId = `st-sim-clip-${useId().replace(/:/g, "")}`;
  const log = frame.log;
  const visibleIdx = names.map((n, i) => (hidden.has(n) ? -1 : i)).filter((i) => i >= 0);
  const directLabels = width >= 560 && visibleIdx.length > 0 && visibleIdx.length <= 4;

  // Ticks first: their label width sets the left margin.
  const yt = log
    ? logTicks(frame.y0, frame.y1)
    : (() => {
        const t = niceTicks(frame.y0, frame.y1, width < 480 ? 4 : 5);
        return { values: t.values, labels: t.values.map((v) => formatTick(v, t.step)) };
      })();
  const tickW = Math.max(18, ...yt.labels.map((l) => l.length * 6.3)) + 10;

  const w = Math.max(280, width);
  const h = Math.round(Math.min(440, Math.max(260, w * 0.5)));
  const padL = 26 + tickW;
  // Direct labels get the room their full names need (up to ~28% of the chart), so they're
  // only shortened when a name genuinely can't fit; ~6.2px per 11px glyph plus the leader.
  const labelCap = Math.max(10, Math.floor((w * 0.28 - 26) / 6.2));
  const labelChars = directLabels ? Math.min(labelCap, Math.max(...visibleIdx.map((i) => names[i].length))) : 0;
  const padR = directLabels ? Math.ceil(26 + labelChars * 6.2) : 18;
  const padT = 16;
  const padB = 46;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(40, h - padT - padB);
  const xSpan = frame.x1 - frame.x0 || 1;
  const ySpan = frame.y1 - frame.y0 || 1;
  const g: Geo = {
    w,
    h,
    padL,
    padR,
    padT,
    padB,
    plotW,
    plotH,
    sx: (x) => padL + ((x - frame.x0) / xSpan) * plotW,
    sy: (v) => padT + plotH - ((v - frame.y0) / ySpan) * plotH,
  };

  const xt = niceTicks(frame.x0, frame.x1, Math.max(3, Math.min(8, Math.floor(plotW / 90))));

  // Hover (exact data, nearest sample).
  const hoverIdx = hoverX !== null ? nearestIndex(exact.x, hoverX) : -1;
  const hx = hoverIdx >= 0 ? exact.x[hoverIdx] : null;

  const pointerToX = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || !exact.x.length) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const x = frame.x0 + ((px - padL) / plotW) * xSpan;
    const i = nearestIndex(exact.x, x);
    if (i >= 0) onHoverX(exact.x[i]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const n = exact.x.length;
    if (!n) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const stepN = e.shiftKey ? Math.max(1, Math.round(n / 10)) : 1;
      const cur = hoverIdx >= 0 ? hoverIdx : e.key === "ArrowLeft" ? n : -1;
      const next =
        e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowLeft" ? Math.max(0, cur - stepN) : Math.min(n - 1, cur + stepN);
      onHoverX(exact.x[next]);
    } else if (e.key === "Escape") onHoverX(null);
  };

  // Direct end labels, nudged apart so they never collide.
  const endLabels = directLabels
    ? visibleIdx
        .map((i) => {
          const lf = lastFinite(frame.ys[i] ?? [], log);
          return lf ? { i, y: g.sy(lf.v), x: g.sx(frame.x[lf.i]) } : null;
        })
        .filter((v): v is { i: number; y: number; x: number } => v !== null)
        .sort((a, b) => a.y - b.y)
    : [];
  for (let k = 1; k < endLabels.length; k++) {
    if (endLabels[k].y - endLabels[k - 1].y < 14) endLabels[k].y = endLabels[k - 1].y + 14;
  }
  const overflow = endLabels.length ? endLabels[endLabels.length - 1].y - (padT + plotH) : 0;
  if (overflow > 0) endLabels.forEach((l) => (l.y -= overflow));

  const dimFor = (name: string) => (emphasis && emphasis !== name ? 0.22 : 1);
  const showZero = !log && frame.y0 < 0 && frame.y1 > 0;
  const primaryTrailIdx = visibleIdx[0] ?? -1;

  // Tooltip rows.
  const tipRows =
    hx !== null
      ? visibleIdx.map((i) => ({ i, name: names[i], v: exact.ys[i]?.[hoverIdx] }))
      : [];
  const pinRows =
    hx !== null
      ? pins.flatMap((p) =>
          visibleIdx
            .slice(0, pins.length * visibleIdx.length > 6 ? 1 : visibleIdx.length)
            .map((i) => {
              const s = p.series.find((ss) => ss.name === names[i]);
              return { key: `${p.id}-${i}`, n: p.n, i, name: names[i], v: s ? valueAt(p.x, s.y, hx) : null };
            })
        )
      : [];
  const tipLeft = hx !== null ? g.sx(hx) : 0;
  // Open towards the side with more room, and never wider than that room (no overflow on phones).
  const roomRight = w - tipLeft;
  const flip = roomRight < 250 && tipLeft > roomRight;
  const tipRoom = Math.max(120, (flip ? tipLeft : roomRight) - 22);

  const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label={`Chart of ${yLabel} against ${xLabel}. Use the arrow keys to read values.`}
      onKeyDown={onKeyDown}
      onBlur={() => onHoverX(null)}
      className="apple-focus relative w-full select-none rounded-xl"
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block max-w-full" role="presentation">
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={padT - 4} width={plotW + 4} height={plotH + 8} />
          </clipPath>
        </defs>

        {/* horizontal grid + y ticks */}
        {yt.values.map((v, k) => {
          const y = g.sy(v);
          if (y < padT - 1 || y > padT + plotH + 1) return null;
          return (
            <g key={`y${k}`}>
              <line x1={padL} x2={padL + plotW} y1={y} y2={y} style={{ stroke: "var(--border-subtle)" }} />
              <text
                x={padL - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10.5"
                className="tabular-nums"
                style={{ fill: "var(--text-muted)" }}
              >
                {yt.labels[k]}
              </text>
            </g>
          );
        })}

        {/* x baseline + ticks */}
        <line
          x1={padL}
          x2={padL + plotW}
          y1={padT + plotH}
          y2={padT + plotH}
          style={{ stroke: "var(--border-strong)" }}
        />
        {xt.values.map((v, k) => {
          const x = g.sx(v);
          if (x < padL - 1 || x > padL + plotW + 1) return null;
          return (
            <g key={`x${k}`}>
              <line x1={x} x2={x} y1={padT + plotH} y2={padT + plotH + 4} style={{ stroke: "var(--border-strong)" }} />
              <text
                x={x}
                y={padT + plotH + 16}
                textAnchor="middle"
                fontSize="10.5"
                className="tabular-nums"
                style={{ fill: "var(--text-muted)" }}
              >
                {formatTick(v, xt.step)}
              </text>
            </g>
          );
        })}

        {showZero && (
          <line
            x1={padL}
            x2={padL + plotW}
            y1={g.sy(0)}
            y2={g.sy(0)}
            strokeDasharray="4 4"
            style={{ stroke: "var(--text-muted)", opacity: 0.55 }}
          />
        )}

        <g clipPath={`url(#${clipId})`}>
          {/* sweep trace: one faint curve per sweep step, darker = later in the sweep */}
          {primaryTrailIdx >= 0 &&
            trail.map((run, k) => {
              const s = run.series.find((ss) => ss.name === names[primaryTrailIdx]);
              if (!s) return null;
              return (
                <path
                  key={`trail${k}`}
                  d={linePath(run.x, s.y, g, log)}
                  fill="none"
                  strokeWidth={1.25}
                  style={{ stroke: "var(--accent)", opacity: 0.1 + run.t * 0.4 }}
                />
              );
            })}

          {/* pinned ghosts */}
          {pins.map((p) => {
            const hot = highlightedPin === p.id;
            return (
              <g key={p.id} style={{ opacity: highlightedPin && !hot ? 0.15 : hot ? 0.9 : 0.4, transition: "opacity 180ms" }}>
                {visibleIdx.map((i) => {
                  const s = p.series.find((ss) => ss.name === names[i]);
                  if (!s) return null;
                  return (
                    <path
                      key={i}
                      d={linePath(p.x, s.y, g, log)}
                      fill="none"
                      strokeWidth={hot ? 2 : 1.5}
                      strokeDasharray={seriesDash(i)}
                      strokeLinecap="round"
                      style={{ stroke: seriesColor(i) }}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* live series */}
          {names.map((name, i) =>
            hidden.has(name) ? null : (
              <path
                key={name}
                d={linePath(frame.x, frame.ys[i] ?? [], g, log)}
                fill="none"
                strokeWidth={emphasis === name ? 2.75 : 2}
                strokeDasharray={seriesDash(i)}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ stroke: seriesColor(i), opacity: dimFor(name), transition: "opacity 180ms, stroke-width 180ms" }}
              />
            )
          )}
        </g>

        {/* direct labels (text in text tokens; the leader stroke carries the colour) */}
        {endLabels.map((l) => (
          <g key={`lab${l.i}`} style={{ opacity: dimFor(names[l.i]), transition: "opacity 180ms" }}>
            <line x1={padL + plotW + 4} x2={padL + plotW + 14} y1={l.y} y2={l.y} strokeWidth={2} style={{ stroke: seriesColor(l.i) }} />
            <text x={padL + plotW + 18} y={l.y + 3.5} fontSize="11" fontWeight={500} style={{ fill: "var(--text-secondary)" }}>
              <title>{names[l.i]}</title>
              {names[l.i].length > labelCap ? `${names[l.i].slice(0, labelCap - 1)}…` : names[l.i]}
            </text>
          </g>
        ))}

        {/* hover crosshair + markers */}
        {hx !== null && (
          <g pointerEvents="none">
            <line
              x1={g.sx(hx)}
              x2={g.sx(hx)}
              y1={padT}
              y2={padT + plotH}
              style={{ stroke: "var(--text-muted)", opacity: 0.7 }}
              strokeDasharray="3 3"
            />
            {visibleIdx.map((i) => {
              const v = toScale(exact.ys[i]?.[hoverIdx] ?? NaN, log);
              if (!Number.isFinite(v)) return null;
              return (
                <circle
                  key={i}
                  cx={g.sx(hx)}
                  cy={clampN(g.sy(v), padT, padT + plotH)}
                  r={4.5}
                  strokeWidth={2}
                  style={{ fill: seriesColor(i), stroke: "var(--bg-surface-solid)" }}
                />
              );
            })}
          </g>
        )}

        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          fill="transparent"
          style={{ cursor: "crosshair", touchAction: "pan-y" }}
          onPointerMove={pointerToX}
          onPointerDown={pointerToX}
          onPointerLeave={() => onHoverX(null)}
        />
      </svg>

      {/* axis titles (HTML so they can carry math) */}
      <div
        className="pointer-events-none absolute left-0 flex items-center justify-center"
        style={{ top: padT, height: plotH, width: 22 }}
      >
        <span
          className="block shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-center text-[11px] font-semibold text-[var(--text-secondary)]"
          style={{ transform: "rotate(-90deg)", width: plotH }}
        >
          <RichText text={yLabel} />
          {log && <span className="ml-1 font-normal text-[var(--text-muted)]">(log scale)</span>}
        </span>
      </div>
      <div
        className="pointer-events-none absolute truncate text-center text-[11px] font-semibold text-[var(--text-secondary)]"
        style={{ left: padL, width: plotW, top: padT + plotH + 24 }}
      >
        <RichText text={xLabel} />
      </div>

      {busy && (
        <div
          aria-hidden
          className="pointer-events-none absolute overflow-hidden rounded-full"
          style={{ left: padL, width: plotW, top: padT + plotH - 1, height: 2 }}
        >
          <div className="st-progress h-full w-1/3 rounded-full bg-[var(--accent)]" />
        </div>
      )}

      {/* tooltip */}
      {hx !== null && (tipRows.length > 0 || pinRows.length > 0) && (
        <div
          role="status"
          aria-live="polite"
          className="apple-glass-elevated pointer-events-none absolute z-20 rounded-2xl border px-3 py-2"
          style={{
            top: padT + 6,
            left: flip ? undefined : tipLeft + 14,
            right: flip ? w - tipLeft + 14 : undefined,
            minWidth: Math.min(176, tipRoom),
            maxWidth: Math.min(256, tipRoom),
          }}
        >
          <p className="mb-1 flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] pb-1 text-[11px] text-[var(--text-muted)]">
            <span className="truncate">
              <RichText text={xLabel} />
            </span>
            <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">{formatValue(hx)}</span>
          </p>
          {tipRows.map((r) => (
            <p key={r.i} className="flex items-center justify-between gap-3 py-0.5 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]">
                <Swatch idx={r.i} />
                <RichText className="truncate" text={r.name} />
              </span>
              <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">{formatValue(r.v)}</span>
            </p>
          ))}
          {pinRows.length > 0 && (
            <div className="mt-1 border-t border-[var(--border-subtle)] pt-1">
              {pinRows.map((r) => (
                <p key={r.key} className="flex items-center justify-between gap-3 py-0.5 text-[10.5px] text-[var(--text-muted)]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Swatch idx={r.i} ghost />
                    <span className="truncate">
                      Pin {r.n}
                      {visibleIdx.length > 1 ? ` · ${r.name}` : ""}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums">{formatValue(r.v)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* avatar callouts */}
      {callouts.map((c, idx) => (
        <div
          key={idx}
          style={{ left: clampN(c.x ?? 220, 8, Math.max(8, w - 220)), top: clampN(c.y ?? 100, 8, Math.max(8, h - 48)) }}
          className="apple-glass-elevated st-fade-down pointer-events-none absolute z-10 max-w-52 rounded-xl border border-[var(--status-warning-border)] px-2.5 py-1 text-xs font-medium text-[var(--status-warning)]"
        >
          <RichText text={c.label} />
        </div>
      ))}
    </div>
  );
}

/* ---------------- table view ---------------- */

export function DataTable({
  frame,
  names,
  hidden,
  xLabel,
}: {
  frame: Frame;
  names: string[];
  hidden: Set<string>;
  xLabel: string;
}) {
  const n = frame.x.length;
  const stride = Math.max(1, Math.ceil(n / 60));
  const rows: number[] = [];
  for (let i = 0; i < n; i += stride) rows.push(i);
  if (n && rows[rows.length - 1] !== n - 1) rows.push(n - 1);
  const cols = names.map((nm, i) => ({ nm, i })).filter((c) => !hidden.has(c.nm));
  return (
    // Solid surface (not glass) so rows stay crisp and the sticky header hides rows scrolling under it.
    <div className="st-fade-up max-h-72 overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-solid)]">
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">Simulation values{stride > 1 ? `, every ${stride}th sample` : ""}</caption>
        <thead className="sticky top-0 z-[1] bg-[var(--bg-surface-solid)] shadow-[inset_0_-1px_0_var(--border-subtle)]">
          <tr>
            <th scope="col" className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-[var(--text-secondary)]">
              <RichText text={xLabel} />
            </th>
            {cols.map((c) => (
              <th key={c.nm} scope="col" className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1.5">
                  <Swatch idx={c.i} />
                  {c.nm}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map((r) => (
            <tr key={r} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-surface-muted)]">
              <td className="whitespace-nowrap px-3 py-1 text-[var(--text-secondary)]">{formatValue(frame.x[r])}</td>
              {cols.map((c) => (
                <td key={c.nm} className="whitespace-nowrap px-3 py-1 text-right text-[var(--text-primary)]">
                  {formatValue(frame.ys[c.i]?.[r])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {stride > 1 && (
        <p className="border-t border-[var(--border-subtle)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
          Showing every {stride}th of {n} samples. Export CSV for the full series.
        </p>
      )}
    </div>
  );
}
