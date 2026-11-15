"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight, Crosshair } from "lucide-react";
import { RichText } from "../../math/MathTex";
import { formatValue, nearestIndex, seriesStats } from "./format";
import type { Frame } from "./hooks";
import { Swatch, type PinnedRun } from "./SimChart";

interface ReadoutsProps {
  /** Tweened frame, so the numbers roll smoothly as the curves morph. */
  frame: Frame;
  exact: Frame;
  names: string[];
  hidden: Set<string>;
  xLabel: string;
  hoverX: number | null;
  /** Most recent pin, used for the "vs pin" delta. */
  pin: PinnedRun | null;
  onEmphasis: (name: string | null) => void;
}

function delta(now: number | null, then: number | null): { text: string; up: boolean } | null {
  if (now === null || then === null || !Number.isFinite(now) || !Number.isFinite(then)) return null;
  const d = now - then;
  if (Math.abs(d) < 1e-12) return { text: "no change", up: true };
  const rel = Math.abs(then) > 1e-12 ? ` (${d > 0 ? "+" : ""}${((d / Math.abs(then)) * 100).toFixed(Math.abs(d / then) < 0.1 ? 1 : 0)}%)` : "";
  return { text: `${d > 0 ? "+" : ""}${formatValue(d, 3)}${rel}`, up: d > 0 };
}

/** Live key numbers per series: final value, extremes and where they occur, value under the cursor. */
export function Readouts({ frame, exact, names, hidden, xLabel, hoverX, pin, onEmphasis }: ReadoutsProps) {
  const shown = names.map((n, i) => ({ n, i })).filter((s) => !hidden.has(s.n));
  if (!shown.length || !frame.x.length) return null;
  const hoverIdx = hoverX !== null ? nearestIndex(exact.x, hoverX) : -1;
  const xName = xLabel.replace(/\s*\([^)]*\)\s*$/, "") || "x";

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(13.5rem,100%),1fr))] gap-2.5">
      {shown.map(({ n, i }, k) => {
        const st = seriesStats(frame.x, frame.ys[i] ?? []);
        const pinSeries = pin?.series.find((s) => s.name === n);
        const pinFinal = pin && pinSeries ? seriesStats(pin.x, pinSeries.y).final : null;
        const d = delta(seriesStats(exact.x, exact.ys[i] ?? []).final, pinFinal);
        const atHover = hoverIdx >= 0 ? exact.ys[i]?.[hoverIdx] : undefined;
        return (
          <div
            key={n}
            onMouseEnter={() => onEmphasis(n)}
            onMouseLeave={() => onEmphasis(null)}
            style={{ animationDelay: `${120 + k * 50}ms` }}
            className="apple-card st-fade-up min-w-0 rounded-2xl border p-3"
          >
            <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]" title={n}>
              <Swatch idx={i} />
              <RichText className="min-w-0 truncate" text={n} />
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                {atHover !== undefined ? "At cursor" : "Final"}
              </span>
              <span className="min-w-0 break-all font-mono text-xl font-semibold tabular-nums tracking-tight text-[var(--text-primary)]">
                {formatValue(atHover !== undefined ? atHover : st.final)}
              </span>
            </div>
            {atHover !== undefined && (
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[var(--text-muted)]">
                <Crosshair className="h-3 w-3" />
                <RichText text={xName} /> = {formatValue(exact.x[hoverIdx])}
              </p>
            )}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-[var(--border-subtle)] pt-2 text-[10.5px]">
              <dt className="text-[var(--text-muted)]">Min</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                {formatValue(st.min)}
                <span className="text-[var(--text-muted)]"> @ {formatValue(st.minX, 3)}</span>
              </dd>
              <dt className="text-[var(--text-muted)]">Max</dt>
              <dd className="text-right font-mono tabular-nums text-[var(--text-secondary)]">
                {formatValue(st.max)}
                <span className="text-[var(--text-muted)]"> @ {formatValue(st.maxX, 3)}</span>
              </dd>
              {pin && d && (
                <>
                  <dt className="text-[var(--text-muted)]">vs Pin {pin.n}</dt>
                  <dd className="flex items-center justify-end gap-0.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                    {d.text !== "no change" &&
                      (d.up ? (
                        <ArrowUpRight className="h-3 w-3 text-[var(--text-muted)]" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3 text-[var(--text-muted)]" />
                      ))}
                    {d.text}
                  </dd>
                </>
              )}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
