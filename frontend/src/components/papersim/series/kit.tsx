"use client";

/** Small shared building blocks for the PaperSim analysis tabs. */
import React, { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/** Same dash order as the main simulation plot, so a series looks identical everywhere. */
export const SERIES_DASHES: (string | undefined)[] = [undefined, "8 4", "2 3", "10 4 2 4", "14 4"];
/** Okabe-Ito fallback, in fixed order (never cycled by rank). */
export const SERIES_FALLBACK = ["#0284c7", "#e69f00", "#009e73", "#cc79a7", "#d55e00"];

export function seriesColor(color: string | undefined, idx: number): string {
  return color || SERIES_FALLBACK[idx % SERIES_FALLBACK.length];
}
export function seriesDash(idx: number): string | undefined {
  return SERIES_DASHES[idx % SERIES_DASHES.length];
}

/** Colour + dash line key, so identity never relies on colour alone. */
export function SeriesSwatch({ color, dash, width = 22 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg width={width} height="10" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="5"
        x2={width - 1}
        y2="5"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Callback-ref + width of an element, tracked with ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) >= 1 ? Math.round(w) : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

/** "Nice" axis ticks (1 / 2 / 2.5 / 5 × 10^k). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/** Copy-to-clipboard button with a transient "Copied" state. */
export function CopyButton({
  text,
  label = "Copy",
  className = "",
  title,
}: {
  text: string | (() => string);
  label?: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`apple-press apple-focus inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)] ${className}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--status-support)]" /> : <Copy className="h-3.5 w-3.5" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

/** Stagger helper for st-fade-up / st-rise. */
export function stagger(i: number, step = 60, base = 0): React.CSSProperties {
  return { animationDelay: `${base + i * step}ms` };
}
