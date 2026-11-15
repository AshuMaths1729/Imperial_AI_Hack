"use client";

import React, { useState } from "react";
import { Check, RotateCcw, Sparkle } from "lucide-react";
import type { SimPreset, SimulationParam } from "../../../types/scholartwin";
import { RichText } from "../../math/MathTex";
import { clampSnap } from "./format";

interface PresetBarProps {
  params: SimulationParam[];
  presets: SimPreset[];
  values: Record<string, number>;
  onApply: (next: Record<string, number>) => void;
}

/** Preset params merged onto the defaults (so a preset is reproducible) and snapped to range. */
export function resolvePreset(preset: SimPreset, params: SimulationParam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    const v = preset.params?.[p.key];
    out[p.key] = clampSnap(typeof v === "number" ? v : p.default_val, p);
  }
  return out;
}

export function defaultsOf(params: SimulationParam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) out[p.key] = p.default_val;
  return out;
}

export function matches(a: Record<string, number>, b: Record<string, number>, params: SimulationParam[]): boolean {
  return params.every((p) => {
    const tol = p.step > 0 ? p.step / 2 : Math.abs(p.max_val - p.min_val) * 1e-6;
    return Math.abs((a[p.key] ?? p.default_val) - (b[p.key] ?? p.default_val)) <= tol;
  });
}

/** Scenario chips from the paper (docs.presets) + "Paper defaults". Active chip = current values. */
export function PresetBar({ params, presets, values, onApply }: PresetBarProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const defaults = defaultsOf(params);
  const atDefaults = matches(values, defaults, params);
  const resolved = presets.map((p) => resolvePreset(p, params));
  const activeIdx = resolved.findIndex((r) => matches(values, r, params));
  const describeIdx = hovered ?? (activeIdx >= 0 ? activeIdx : null);
  const described = describeIdx !== null ? presets[describeIdx] : null;

  return (
    <div className="st-fade-up rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="apple-label mr-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
          <Sparkle className="h-3 w-3" />
          Scenarios
        </span>
        <button
          type="button"
          onClick={() => onApply(defaults)}
          aria-pressed={atDefaults}
          className={`apple-press apple-focus flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
            atDefaults
              ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-muted)]"
          }`}
        >
          {atDefaults ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
          {atDefaults ? "Paper defaults" : "Reset all"}
        </button>
        {presets.map((preset, i) => {
          const active = i === activeIdx;
          return (
            <button
              key={`${preset.name}-${i}`}
              type="button"
              onClick={() => onApply(resolved[i])}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              aria-pressed={active}
              title={preset.description}
              className={`apple-press apple-focus flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--text-primary)]"
              }`}
            >
              {active && <Check className="h-3 w-3" />}
              {preset.name}
            </button>
          );
        })}
      </div>
      {described?.description && (
        <p key={describeIdx} className="st-fade-down mt-2 px-1 text-[11px] leading-snug text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-secondary)]">{described.name}: </span>
          <RichText text={described.description} />
          {described.expected && (
            <>
              {" "}
              <span className="font-semibold text-[var(--accent)]">What to look for: </span>
              <RichText text={described.expected} />
            </>
          )}
          {described.source?.page != null && (
            <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">
              ({described.source.section ? `${described.source.section}, ` : ""}p.{described.source.page})
            </span>
          )}
        </p>
      )}
    </div>
  );
}
