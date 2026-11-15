"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Eye, EyeOff } from "lucide-react";
import type { SeriesDoc } from "../../../types/scholartwin";
import { RichText } from "../../math/MathTex";
import { formatValue, nearestIndex, seriesStats } from "./format";
import type { Frame } from "./hooks";
import { Swatch, type PinnedRun } from "./SimChart";

interface SeriesLegendProps {
  /** Tweened frame, so the numbers roll smoothly as the curves morph. */
  frame: Frame;
  /** Exact latest data (cursor values and pin deltas read from this, never from the tween). */
  exact: Frame;
  names: string[];
  docs: Map<string, SeriesDoc>;
  hidden: Set<string>;
  xLabel: string;
  hoverX: number | null;
  /** Most recent pin, used for the "vs pin" delta. */
  pin: PinnedRun | null;
  onToggle: (name: string) => void;
  onEmphasis: (name: string | null) => void;
}

function delta(now: number | null, then: number | null): { text: string; up: boolean } | null {
  if (now === null || then === null || !Number.isFinite(now) || !Number.isFinite(then)) return null;
  const d = now - then;
  if (Math.abs(d) < 1e-12) return { text: "no change", up: true };
  const rel =
    Math.abs(then) > 1e-12
      ? ` (${d > 0 ? "+" : ""}${((d / Math.abs(then)) * 100).toFixed(Math.abs(d / then) < 0.1 ? 1 : 0)}%)`
      : "";
  return { text: `${d > 0 ? "+" : ""}${formatValue(d, 3)}${rel}`, up: d > 0 };
}

/** One number in a row. Below lg its label sits above it; from lg the shared header names it. */
function Cell({
  label,
  children,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] lg:sr-only">{label}</div>
      {children}
    </div>
  );
}

/** An extreme and where it occurs: "0.375 @ 0.98" on one line from lg, two short lines below it. */
function Extreme({ value, at, tone }: { value: number | null; at: number | null; tone: string }) {
  return (
    <span className={`block font-mono text-xs tabular-nums ${tone}`}>
      {formatValue(value)}
      <span className="block whitespace-nowrap text-[11px] text-[var(--text-muted)] lg:inline lg:text-xs">
        <span className="lg:hidden">at </span>
        <span className="hidden lg:inline"> @ </span>
        {formatValue(at, 3)}
      </span>
    </span>
  );
}

/**
 * The Simulate tab's one legend: each series is named once, with its swatch (colour + dash), and its
 * key numbers (final value, or the value under the cursor; min and max with where they occur; the
 * change against the latest pin) sit on the same row. Click a name to show or hide the series;
 * hover a row to spotlight its curve; hover or focus the name for what the series means.
 */
export function SeriesLegend({
  frame,
  exact,
  names,
  docs,
  hidden,
  xLabel,
  hoverX,
  pin,
  onToggle,
  onEmphasis,
}: SeriesLegendProps) {
  if (!names.length || !frame.x.length) return null;
  const hoverIdx = hoverX !== null ? nearestIndex(exact.x, hoverX) : -1;
  const xName = xLabel.replace(/\s*\([^)]*\)\s*$/, "") || "x";
  const toggleable = names.length > 1;
  const valueLabel = hoverIdx >= 0 ? "At cursor" : "Final";
  // Fixed numeric columns, so every row lines up under the one header (lg and up).
  const cols = pin
    ? "lg:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_7.5rem_8rem]"
    : "lg:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_7.5rem]";

  return (
    <div role="group" aria-label="Series and their values">
      <div
        aria-hidden
        className={`hidden gap-x-3 px-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)] lg:grid ${cols}`}
      >
        {hoverIdx >= 0 ? (
          <span className="truncate normal-case tracking-normal">
            Cursor at <RichText text={xName} /> = {formatValue(exact.x[hoverIdx])}
          </span>
        ) : (
          <span>Series</span>
        )}
        <span className="text-right">{valueLabel}</span>
        <span className="text-right">Min</span>
        <span className="text-right">Max</span>
        {pin && <span className="text-right">vs Pin {pin.n}</span>}
      </div>
      <ul className="divide-y divide-[var(--border-subtle)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]">
        {names.map((name, i) => {
          const off = hidden.has(name);
          const doc = docs.get(name.trim().toLowerCase());
          const st = seriesStats(frame.x, frame.ys[i] ?? []);
          const pinSeries = pin?.series.find((s) => s.name === name);
          const pinFinal = pin && pinSeries ? seriesStats(pin.x, pinSeries.y).final : null;
          const d = delta(seriesStats(exact.x, exact.ys[i] ?? []).final, pinFinal);
          const atHover = hoverIdx >= 0 ? exact.ys[i]?.[hoverIdx] : undefined;
          const value = atHover !== undefined ? atHover : st.final;
          const num = off ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]";
          const sub = off ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]";

          const nameInner = (
            <>
              <span className={`shrink-0 ${off ? "opacity-40" : ""}`}>
                <Swatch idx={i} />
              </span>
              <RichText className={`min-w-0 truncate ${off ? "line-through" : ""}`} text={name} />
            </>
          );

          return (
            <li
              key={name}
              onMouseEnter={() => !off && onEmphasis(name)}
              onMouseLeave={() => onEmphasis(null)}
              className={`grid grid-cols-3 items-baseline sm:grid-cols-[repeat(3,minmax(0,10rem))] gap-x-3 gap-y-1.5 px-2.5 py-2 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-[var(--bg-surface-muted)] lg:items-center ${cols}`}
            >
              {/* Name (+ what it means, on hover / focus). */}
              <div className="group/name relative col-span-3 min-w-0 lg:col-span-1">
                {toggleable ? (
                  <button
                    type="button"
                    aria-pressed={!off}
                    title={off ? `Show ${name}` : `Hide ${name}`}
                    onClick={() => onToggle(name)}
                    onFocus={() => !off && onEmphasis(name)}
                    onBlur={() => onEmphasis(null)}
                    className={`apple-press apple-focus -mx-1.5 flex max-w-full items-center gap-2 rounded-full px-1.5 py-0.5 text-left text-[13px] ${
                      off ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
                    }`}
                  >
                    {nameInner}
                    {off ? (
                      <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-within/name:opacity-100" aria-hidden />
                    )}
                  </button>
                ) : (
                  <span tabIndex={doc ? 0 : undefined} className="apple-focus flex max-w-full items-center gap-2 rounded-full text-[13px] text-[var(--text-primary)]">
                    {nameInner}
                  </span>
                )}
                {doc && (
                  <div
                    role="tooltip"
                    className="apple-glass-elevated pointer-events-none invisible absolute left-0 top-full z-30 mt-1.5 w-[min(19rem,calc(100vw-4rem))] rounded-2xl border p-3 opacity-0 transition-opacity duration-150 group-focus-within/name:visible group-focus-within/name:opacity-100 group-hover/name:visible group-hover/name:opacity-100"
                  >
                    <p className="text-xs leading-snug text-[var(--text-secondary)]">
                      <RichText text={doc.meaning} />
                    </p>
                    {doc.how_to_read && (
                      <p className="mt-1.5 text-xs leading-snug text-[var(--text-secondary)]">
                        <span className="font-medium text-[var(--text-primary)]">How to read: </span>
                        <RichText text={doc.how_to_read} />
                      </p>
                    )}
                    {toggleable && (
                      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Click to {off ? "show" : "hide"} it</p>
                    )}
                  </div>
                )}
              </div>

              <Cell label={valueLabel} className="lg:text-right">
                <span className={`block break-all font-mono text-[15px] font-medium tabular-nums tracking-tight ${num}`}>
                  {formatValue(value)}
                </span>
              </Cell>
              <Cell label="Min" className="lg:text-right">
                <Extreme value={st.min} at={st.minX} tone={sub} />
              </Cell>
              <Cell label="Max" className="lg:text-right">
                <Extreme value={st.max} at={st.maxX} tone={sub} />
              </Cell>
              {pin && (
                <Cell label={`vs Pin ${pin.n}`} className="col-span-3 lg:col-span-1 lg:text-right">
                  <span className={`inline-flex items-center gap-0.5 font-mono text-xs tabular-nums ${sub}`}>
                    {d && d.text !== "no change" &&
                      (d.up ? (
                        <ArrowUpRight className="h-3 w-3 text-[var(--text-muted)]" aria-label="up" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3 text-[var(--text-muted)]" aria-label="down" />
                      ))}
                    {d ? d.text : "—"}
                  </span>
                </Cell>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
