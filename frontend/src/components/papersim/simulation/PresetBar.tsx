"use client";

import React, { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
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

/** Ink-filled when chosen (Meadow Glass: the chosen scenario reads as solid ink on paper). */
const CHIP_ON =
  "border-transparent bg-[var(--text-primary)] text-[var(--bg-surface-solid)] shadow-[var(--shadow-card)]";
const CHIP_OFF =
  "apple-glass border-[var(--glass-rim)] text-[var(--text-primary)] hover:border-[var(--accent-border)]";

/**
 * Scenario chips from the paper (docs.presets) + "Paper defaults", at the top of the chart card.
 * The active chip matches the current values; hovering a chip explains it.
 */
export function PresetBar({ params, presets, values, onApply }: PresetBarProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const defaults = defaultsOf(params);
  const atDefaults = matches(values, defaults, params);
  const resolved = presets.map((p) => resolvePreset(p, params));
  const activeIdx = resolved.findIndex((r) => matches(values, r, params));
  const describeIdx = hovered ?? (activeIdx >= 0 ? activeIdx : null);
  const described = describeIdx !== null ? presets[describeIdx] : null;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Scenarios">
        <button
          type="button"
          onClick={() => onApply(defaults)}
          aria-pressed={atDefaults}
          title={atDefaults ? "The paper's own parameter values" : "Back to the paper's own parameter values"}
          className={`apple-press apple-focus flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${
            atDefaults ? CHIP_ON : CHIP_OFF
          }`}
        >
          {atDefaults ? <Check className="h-3 w-3" aria-hidden /> : <RotateCcw className="h-3 w-3" aria-hidden />}
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
              className={`apple-press apple-focus flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-xs font-medium ${
                active ? CHIP_ON : CHIP_OFF
              }`}
            >
              {active && <Check className="h-3 w-3 shrink-0" aria-hidden />}
              {preset.name}
            </button>
          );
        })}
      </div>
      {described?.description && (
        <p key={describeIdx} className="st-fade-down mt-2 px-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">{described.name}: </span>
          <RichText text={described.description} />
          {described.expected && (
            <>
              {" "}
              <span className="font-medium text-[var(--accent)]">What to look for: </span>
              <RichText text={described.expected} />
            </>
          )}
          {described.source?.page != null && (
            <span className="ml-1 font-mono text-[11px] text-[var(--text-muted)]">
              ({described.source.section ? `${described.source.section}, ` : ""}p.{described.source.page})
            </span>
          )}
        </p>
      )}
    </div>
  );
}
