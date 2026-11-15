"use client";

import React, { useEffect, useRef, useState } from "react";
import { Eraser, Layers, Pause, Play } from "lucide-react";
import type { ParamDoc, SimulationParam } from "../../../types/scholartwin";
import { Tex } from "../../math/MathTex";
import { clampSnap, formatParam, paramLabel, paramSymbol } from "./format";

/* ---------------- sweep engine ---------------- */

interface SweepRun {
  key: string;
  values: number[];
  token: number;
}

/** Evenly spaced, step-snapped values across a parameter's range (2–24 frames). */
export function sweepValues(p: SimulationParam): number[] {
  const span = p.max_val - p.min_val;
  if (!(span > 0)) return [p.min_val];
  const raw = p.step > 0 ? Math.floor(span / p.step + 1e-9) + 1 : 24;
  const n = Math.max(2, Math.min(24, raw));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = clampSnap(p.min_val + (span * i) / (n - 1), p);
    if (!out.length || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

interface UseSweepArgs {
  /** Called once per frame with the full param set to run. */
  apply: (key: string, value: number) => void;
  /** Called after each frame has had time to render (t = 0..1 progress). */
  capture: (t: number) => void;
  /** Called (from the click handler) when a new sweep starts. */
  onStart?: () => void;
  intervalMs: number;
}

/**
 * Steps one parameter across its range, one backend run per tick (throttled by `intervalMs`).
 * Everything happens in the interval callback, so no state is set synchronously in an effect.
 */
export function useSweep({ apply, capture, onStart, intervalMs }: UseSweepArgs) {
  const [run, setRun] = useState<SweepRun | null>(null);
  const [frame, setFrame] = useState(0);
  const applyRef = useRef(apply);
  const captureRef = useRef(capture);
  const tokenRef = useRef(0);

  useEffect(() => {
    applyRef.current = apply;
    captureRef.current = capture;
  }, [apply, capture]);

  useEffect(() => {
    if (!run) return;
    let i = 0;
    const total = run.values.length;
    const id = window.setInterval(() => {
      // The previous frame's result has had a full interval to arrive: record it.
      if (i > 0) captureRef.current((i - 1) / Math.max(1, total - 1));
      if (i >= total) {
        window.clearInterval(id);
        setRun(null);
        return;
      }
      applyRef.current(run.key, run.values[i]);
      setFrame(i);
      i += 1;
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [run, intervalMs]);

  return {
    running: run !== null,
    key: run?.key ?? null,
    frame,
    total: run?.values.length ?? 0,
    start: (p: SimulationParam) => {
      tokenRef.current += 1;
      onStart?.();
      setFrame(0);
      setRun({ key: p.key, values: sweepValues(p), token: tokenRef.current });
    },
    stop: () => setRun(null),
  };
}

/* ---------------- panel ---------------- */

interface SweepPanelProps {
  params: SimulationParam[];
  docs: Map<string, ParamDoc>;
  selected: string;
  onSelect: (key: string) => void;
  sweep: ReturnType<typeof useSweep>;
  values: Record<string, number>;
  keepTrace: boolean;
  onKeepTrace: (v: boolean) => void;
  traceCount: number;
  onClearTrace: () => void;
  reducedMotion: boolean;
  style?: React.CSSProperties;
}

export function SweepPanel({
  params,
  docs,
  selected,
  onSelect,
  sweep,
  values,
  keepTrace,
  onKeepTrace,
  traceCount,
  onClearTrace,
  reducedMotion,
  style,
}: SweepPanelProps) {
  const p = params.find((pp) => pp.key === selected) ?? params[0];
  if (!p) return null;
  const sym = paramSymbol(p, docs.get(p.key));
  const progress = sweep.running ? ((sweep.frame + 1) / Math.max(1, sweep.total)) * 100 : 0;

  return (
    // A recessed well at the foot of the Parameters panel.
    <div
      style={style}
      className="st-fade-up rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--text-primary)]">Sweep a parameter</h3>
          <p className="text-xs leading-snug text-[var(--text-secondary)]">
            Re-runs the model across the full range
            {reducedMotion ? " (slowed for reduced motion)" : ""}.
          </p>
        </div>
        {/* The view's one tinted primary action (Paper Simulator hue). */}
        <button
          type="button"
          onClick={() => (sweep.running ? sweep.stop() : sweep.start(p))}
          aria-label={sweep.running ? "Stop sweep" : `Sweep ${paramLabel(p)}`}
          title={sweep.running ? "Stop sweep" : `Sweep ${paramLabel(p)}`}
          style={{ "--tint": "var(--status-support)" } as React.CSSProperties}
          className={`apple-press apple-focus relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full ${
            sweep.running
              ? "border border-[var(--status-support-border)] bg-[var(--status-support-soft)] text-[var(--status-support)]"
              : "apple-tint st-sheen"
          }`}
        >
          {sweep.running ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="sr-only" htmlFor="st-sweep-param">
          Parameter to sweep
        </label>
        <select
          id="st-sweep-param"
          value={p.key}
          disabled={sweep.running}
          onChange={(e) => onSelect(e.target.value)}
          className="apple-focus min-w-0 flex-1 cursor-pointer rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface-solid)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:cursor-not-allowed"
        >
          {params.map((pp) => (
            <option key={pp.key} value={pp.key} className="bg-[var(--bg-surface-solid)] text-[var(--text-primary)]">
              {paramLabel(pp)}
            </option>
          ))}
        </select>
        <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--text-secondary)]">
          {sym && <Tex latex={sym} className="mr-1 text-[var(--accent)]" />}
          {formatParam(values[p.key] ?? p.default_val, p)}
        </span>
      </div>

      <div
        className="mt-2.5 h-1.5 overflow-hidden rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]"
        role="progressbar"
        aria-label="Sweep progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
        <span>{formatParam(p.min_val, p)}</span>
        <span>{sweep.running ? `step ${sweep.frame + 1} / ${sweep.total}` : `${sweepValues(p).length} steps`}</span>
        <span>{formatParam(p.max_val, p)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={keepTrace}
            onChange={(e) => onKeepTrace(e.target.checked)}
            className="apple-focus h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <Layers className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          Leave a trace of each step
        </label>
        {traceCount > 0 && (
          <button
            type="button"
            onClick={onClearTrace}
            className="apple-press apple-focus flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <Eraser className="h-3 w-3" />
            Clear {traceCount}
          </button>
        )}
      </div>
    </div>
  );
}
