"use client";

import React, { useId, useState } from "react";
import { BookOpenText, Info, RotateCcw, TrendingUp } from "lucide-react";
import type { ParamDoc, SimulationParam } from "../../../types/scholartwin";
import { RichText, Tex } from "../../math/MathTex";
import { clampSnap, formatParam, isIntegerParam, paramLabel, paramSymbol } from "./format";
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
    // Outer wrapper owns the entrance animation (its fill-mode pins `transform`), the inner card
    // owns the hover lift; raised while the info popover is open so it paints over siblings.
    <div style={style} className={`st-fade-up relative ${infoOpen ? "z-20" : ""}`}>
    <div
      className={`relative h-full rounded-2xl border bg-[var(--bg-surface)] p-3.5 shadow-[var(--shadow-card)] transition-[box-shadow,border-color,transform] duration-200 hover:shadow-[var(--shadow-card-hover)] motion-safe:hover:-translate-y-0.5 ${
        sweeping ? "border-[var(--accent-border)]" : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
      }`}
    >
      {/* Header: symbol + name + info */}
      <div className="flex items-start gap-2.5">
        <div
          aria-hidden={!symbol}
          className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] px-1.5 text-[15px] text-[var(--accent)]"
        >
          {symbol ? <Tex latex={symbol} /> : <span className="text-xs font-semibold">{label.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-range`} className="block truncate text-[13px] font-semibold leading-tight text-[var(--text-primary)]" title={p.name}>
            {label}
          </label>
          {doc?.meaning ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--text-muted)]">
              <RichText text={doc.meaning} />
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
              Range {formatParam(p.min_val, p)} – {formatParam(p.max_val, p)}
              {p.unit ? ` ${p.unit}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onChange(p.default_val)}
            disabled={atDefault}
            title={`Reset to default (${formatParam(p.default_val, p)})`}
            aria-label={`Reset ${label} to default`}
            className="apple-press apple-focus rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {hasInfo && (
            <div ref={infoRef} className="relative">
              <button
                type="button"
                onClick={() => setInfoOpen((o) => !o)}
                aria-expanded={infoOpen}
                aria-label={`About ${label}`}
                className={`apple-press apple-focus rounded-lg p-1.5 hover:bg-[var(--bg-surface-muted)] ${
                  infoOpen ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {infoOpen && doc && (
                <div
                  role="dialog"
                  aria-label={`About ${label}`}
                  className="apple-glass-elevated apple-materialize absolute right-0 top-full z-30 mt-2 w-[min(19rem,80vw)] rounded-2xl border p-3.5 text-left"
                >
                  <div className="mb-2 flex items-center gap-2">
                    {symbol && <Tex latex={symbol} className="text-[var(--accent)]" />}
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{label}</span>
                  </div>
                  {doc.meaning && (
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                      <RichText text={doc.meaning} />
                    </p>
                  )}
                  {doc.effect && (
                    <div className="mt-2.5 flex gap-2 rounded-xl bg-[var(--accent-soft)] p-2.5">
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

      {/* Value row */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1">
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
            className="apple-focus w-[7.5ch] rounded-lg border border-transparent bg-[var(--bg-surface-muted)] px-1.5 py-0.5 font-mono text-[15px] font-semibold tabular-nums text-[var(--text-primary)] hover:border-[var(--border-strong)] focus:border-[var(--accent-border)] focus:outline-none"
          />
          {p.unit && <span className="text-[11px] font-medium text-[var(--text-muted)]">{p.unit}</span>}
        </div>
        {!atDefault && (
          <span className="text-[10px] font-medium text-[var(--text-muted)]">
            default {formatParam(p.default_val, p)}
          </span>
        )}
      </div>

      {/* Slider with filled track + default marker */}
      <div className="relative mt-2.5 pt-1.5">
        <span
          aria-hidden
          title={`Default: ${formatParam(p.default_val, p)}`}
          className="pointer-events-none absolute top-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--text-muted)]"
          style={{ left: `calc(8px + (100% - 16px) * ${defPct / 100})` }}
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
          className="apple-focus w-full"
          style={{
            background: `linear-gradient(to right, var(--accent) 0 ${fill}%, var(--bg-surface-muted) ${fill}% 100%)`,
          }}
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
          <span>{formatParam(p.min_val, p)}</span>
          <span>{formatParam(p.max_val, p)}</span>
        </div>
      </div>
    </div>
    </div>
  );
}
