"use client";

import React from "react";
import { MoveHorizontal, MoveVertical, SlidersHorizontal } from "lucide-react";
import { RichText, Tex } from "../../math/MathTex";
import type { SimulationPayload } from "../../../types/scholartwin";
import { fmtNum } from "./format";
import { stagger } from "./kit";
import { endsWithSymbol } from "../simulation/format";

export function SeriesHeader({
  simulation,
  paramValues,
}: {
  simulation: SimulationPayload;
  paramValues: Record<string, number>;
}) {
  const docs = simulation.docs;
  const n = simulation.x.length;
  const x0 = n ? simulation.x[0] : 0;
  const x1 = n ? simulation.x[n - 1] : 0;
  const paramDocs = new Map((docs?.params ?? []).map((p) => [p.key, p]));

  const axes = [
    {
      key: "x",
      icon: MoveHorizontal,
      axis: "Horizontal axis",
      label: simulation.x_label || "x",
      meaning: docs?.x_meaning,
      extra: n ? `Sampled at ${n} points from ${fmtNum(x0)} to ${fmtNum(x1)}` : "No samples",
    },
    {
      key: "y",
      icon: MoveVertical,
      axis: "Vertical axis",
      label: simulation.y_label || "y",
      meaning: docs?.y_meaning,
      extra: `${simulation.series.length} output series`,
    },
  ];

  return (
    <section className="st-fade-up space-y-4" aria-labelledby="series-heading">
      {/* Page head straight on the landscape: on-scene ink with its glow (two-tone display line). */}
      <div className="px-1">
        <div className="on-scene-soft font-mono text-[11px] font-medium uppercase tracking-[0.12em]">Results</div>
        <h2 id="series-heading" className="on-scene st-display mt-2 text-[30px] sm:text-[36px]">
          What the curves <span className="on-scene-soft">are telling you</span>
        </h2>
        <p className="on-scene mt-2 max-w-2xl text-sm leading-relaxed">
          Every number below is computed live from the simulated data, so it updates as you move the sliders on the
          Simulate tab.
        </p>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 md:gap-3">
        {axes.map((a, i) => {
          const Icon = a.icon;
          return (
            <div
              key={a.key}
              className="st-fade-up apple-card relative min-w-0 rounded-[22px] border p-4"
              style={stagger(i, 80, 60)}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">{a.axis}</div>
                  <div className="mt-0.5 text-[15px] font-normal tracking-[-0.01em] text-[var(--text-primary)]">
                    <RichText text={a.label} />
                  </div>
                  {a.meaning && (
                    <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                      <RichText text={a.meaning} />
                    </div>
                  )}
                  <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">{a.extra}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {simulation.params.length > 0 && (
        <div className="apple-card st-fade-up rounded-[22px] border p-3.5" style={stagger(2, 80, 60)}>
          <div className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-[var(--text-secondary)]">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--accent)]" />
            Computed with these parameter values
          </div>
          <ul className="flex flex-wrap gap-2">
            {simulation.params.map((p) => {
              const v = paramValues[p.key] ?? p.default_val;
              const changed = Math.abs(v - p.default_val) > (p.step || 1e-9) / 2;
              const sym = paramDocs.get(p.key)?.symbol_latex;
              return (
                <li
                  key={p.key}
                  title={changed ? `Changed from default ${fmtNum(p.default_val)}` : "Default value"}
                  className={`flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full border px-3 py-1 text-xs ${
                    changed
                      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]"
                  }`}
                >
                  {/* The symbol leads, unless the name already ends in it ("Recall interval Δ"). */}
                  {!endsWithSymbol(p.name) && (
                    <span className="text-[var(--text-primary)]">
                      {sym ? <Tex latex={sym} /> : <span className="font-mono">{p.key}</span>}
                    </span>
                  )}
                  <span className="text-[var(--text-secondary)]">{p.name}</span>
                  <span className="font-mono font-medium text-[var(--text-primary)]">
                    {fmtNum(v, 4)}
                    {p.unit ? ` ${p.unit}` : ""}
                  </span>
                  {changed && (
                    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--accent)]">edited</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
