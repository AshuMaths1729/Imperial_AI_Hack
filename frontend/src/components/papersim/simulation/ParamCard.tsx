"use client";

import React, { useId, useState } from "react";
import { BookOpenText, Info, RotateCcw, TrendingUp } from "lucide-react";
import type { ParamDoc, SimulationParam } from "../../../types/scholartwin";
import { RichText, Tex } from "../../math/MathTex";
import { clampSnap, endsWithSymbol, formatParam, isIntegerParam, paramLabel, paramSymbol } from "./format";
import { usePopover } from "./hooks";

interface ParamCardProps {
  param: SimulationParam;
  doc?: ParamDoc;
  value: number;
  /** True while a sweep is driving this parameter. */
  sweeping?: boolean;
  onChange: (val: number) => void;
  style?: React.CSSProperties;
}

function pct(v: number, p: SimulationParam): number {
  const span = p.max_val - p.min_val;
  if (!(span > 0)) return 0;
  return Math.min(100, Math.max(0, ((v - p.min_val) / span) * 100));
}

/** One parameter: symbol, meaning, slider with default marker, exact numeric entry, reset, info. */
export function ParamCard({ param: p, doc, value, sweeping, onChange, style }: ParamCardProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const { open: infoOpen, setOpen: setInfoOpen, ref: infoRef } = usePopover<HTMLDivElement>();

  const symbol = paramSymbol(p, doc);
  const label = paramLabel(p);
  const atDefault = Math.abs(value - p.default_val) < (p.step > 0 ? p.step / 2 : 1e-9);
  const fill = pct(value, p);
  const defPct = pct(p.default_val, p);
  const hasInfo = Boolean(doc && (doc.meaning || doc.effect || doc.typical || doc.source));
  const src = doc?.source;
  const srcText = src && (src.section || src.page)
    ? [src.section ? `§${src.section.replace(/^§\s*/, "")}` : null, src.page ? `p. ${src.page}` : null]
        .filter(Boolean)
        .join(", ")
    : null;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseFloat(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(parsed)) {
      const next = clampSnap(parsed, p);
      if (next !== value) onChange(next);
    }
  };

  return (
    // One parameter row inside the Parameters panel (no card of its own, as in the reference design).
    // The wrapper owns the entrance animation; it is raised while the info popover is open so the
    // popover paints over the rows below. While a sweep drives it, it gets an accent ring.
    <div
      style={style}
      // Fill mode backwards: a still-filling animation would stop the info popover's glass blurring.
      className={`st-fade-up ![animation-fill-mode:backwards] relative h-full rounded-2xl p-3 transition-shadow ${infoOpen ? "z-20" : ""} ${
        sweeping ? "bg-[var(--accent-soft)] shadow-[0_0_0_1.5px_var(--accent-border)]" : ""
      }`}
    >
      {/* Name + symbol, exact value, reset and info */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-0.5">
          {/* Wraps (up to two lines) instead of truncating, so the name stays readable in a narrow panel. */}
          <label
            htmlFor={`${id}-range`}
            className="line-clamp-2 block min-w-0 break-words text-sm font-medium leading-snug text-[var(--text-primary)]"
            title={p.name}
          >
            {label}
            {symbol && !endsWithSymbol(label) && (
              <span className="ml-1.5 whitespace-nowrap font-normal text-[var(--accent)]">
                <Tex latex={symbol} />
              </span>
            )}
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <span className="mr-0.5 flex items-baseline gap-1">
            <input
              aria-label={`${label} value`}
              inputMode={isIntegerParam(p) ? "numeric" : "decimal"}
              value={draft ?? formatParam(value, p)}
              onFocus={(e) => {
                setDraft(formatParam(value, p));
                e.currentTarget.select();
              }}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commit();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setDraft(null);
                  e.currentTarget.blur();
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const next = clampSnap(value + (e.key === "ArrowUp" ? 1 : -1) * (p.step || 1), p);
                  setDraft(null);
                  onChange(next);
                }
              }}
              className="apple-focus w-[8ch] rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-0.5 text-right font-mono text-[13px] font-medium tabular-nums text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--accent-border)]"
            />
            {p.unit && <span className="max-w-[5rem] truncate text-[11px] text-[var(--text-muted)]" title={p.unit}>{p.unit}</span>}
          </span>
          <button
            type="button"
            onClick={() => onChange(p.default_val)}
            disabled={atDefault}
            title={`Reset to default (${formatParam(p.default_val, p)})`}
            aria-label={`Reset ${label} to default`}
            className="apple-press apple-focus rounded-full p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {hasInfo && (
            // Not `relative`: the popover anchors to the card, so it always stays inside the
            // card's width (a narrow grid column can't push it off-screen).
            <div ref={infoRef}>
              <button
                type="button"
                onClick={() => setInfoOpen((o) => !o)}
                aria-expanded={infoOpen}
                aria-label={`About ${label}`}
                className={`apple-press apple-focus rounded-full p-1.5 hover:bg-[var(--bg-surface-muted)] ${
                  infoOpen ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {infoOpen && doc && (
                <div
                  role="dialog"
                  aria-label={`About ${label}`}
                  className="apple-glass-elevated apple-materialize absolute right-2 top-12 z-30 w-[min(19rem,calc(100%-1rem))] rounded-2xl border p-3.5 text-left"
                >
                  <div className="mb-2 flex items-center gap-2">
                    {symbol && !endsWithSymbol(label) && <Tex latex={symbol} className="text-[var(--accent)]" />}
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">{label}</span>
                  </div>
                  {doc.meaning && (
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                      <RichText text={doc.meaning} />
                    </p>
                  )}
                  {doc.effect && (
                    <div className="mt-2.5 flex gap-2 rounded-2xl bg-[var(--accent-soft)] p-2.5">
                      <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                        <span className="font-semibold text-[var(--text-primary)]">Increasing it </span>
                        <RichText text={doc.effect.replace(/^increasing (it|this)\s*/i, "")} />
                      </p>
                    </div>
                  )}
                  {doc.typical && (
                    <p className="mt-2.5 text-[11px] text-[var(--text-muted)]">
                      <span className="apple-label font-semibold uppercase text-[var(--text-secondary)]">Typical · </span>
                      <RichText text={doc.typical} />
                    </p>
                  )}
                  {srcText && (
                    <div className="mt-2.5 border-t border-[var(--border-subtle)] pt-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--status-support)]">
                        <BookOpenText className="h-3.5 w-3.5" />
                        Found in paper: {srcText}
                      </p>
                      {src?.quote && (
                        <blockquote className="mt-1 line-clamp-4 border-l-2 border-[var(--status-support-border)] pl-2 text-[11px] italic leading-snug text-[var(--text-muted)]">
                          <RichText text={src.quote} />
                        </blockquote>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Glass slider (globals.css) filled up to the thumb via --fill, with a default tick above */}
      <div className="relative mt-3 pt-2">
        <span
          aria-hidden
          title={`Default: ${formatParam(p.default_val, p)}`}
          className="pointer-events-none absolute top-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--text-muted)]"
          style={{ left: `calc(13px + (100% - 26px) * ${defPct / 100})` }}
        />
        <input
          id={`${id}-range`}
          type="range"
          min={p.min_val}
          max={p.max_val}
          step={p.step > 0 ? p.step : "any"}
          value={value}
          aria-valuetext={`${formatParam(value, p)}${p.unit ? ` ${p.unit}` : ""}`}
          onChange={(e) => onChange(clampSnap(parseFloat(e.target.value), p))}
          className="block w-full"
          style={{ "--fill": `${fill}%` } as React.CSSProperties}
        />
        <div className="mt-2 flex justify-between gap-2 font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
          <span>{formatParam(p.min_val, p)}</span>
          {!atDefault && <span className="truncate">default {formatParam(p.default_val, p)}</span>}
          <span>{formatParam(p.max_val, p)}</span>
        </div>
      </div>

      {/* What it is, in one or two plain lines (the range is already under the slider). */}
      {doc?.meaning && (
        <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-[var(--text-secondary)]">
          <RichText text={doc.meaning} />
        </p>
      )}
    </div>
  );
}
