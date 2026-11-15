"use client";

import React from "react";
import { MoveHorizontal, MoveVertical, SlidersHorizontal } from "lucide-react";
import { RichText, Tex } from "../../math/MathTex";
import type { SimulationPayload } from "../../../types/scholartwin";
import { fmtNum } from "./format";
import { stagger } from "./kit";

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
      <div>
        <div className="apple-label text-[10px] font-semibold uppercase text-[var(--accent)]">Series breakdown</div>
        <h2 id="series-heading" className="apple-display mt-1 text-2xl font-semibold text-[var(--text-primary)]">
          What the curves are telling you
        </h2>
        <div className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">
          Every number below is computed live from the simulated data, so it updates as you move the sliders on the
          simulation tab.
        </div>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 md:gap-3">
        {axes.map((a, i) => {
          const Icon = a.icon;
          return (
            <div
              key={a.key}
              className="st-fade-up apple-card relative min-w-0 rounded-2xl border p-4"
              style={stagger(i, 80, 60)}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">{a.axis}</div>
                  <div className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
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
        <div className="apple-card st-fade-up rounded-2xl border p-3" style={stagger(2, 80, 60)}>
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-[var(--text-secondary)]">
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
                  <span className="text-[var(--text-primary)]">
                    {sym ? <Tex latex={sym} /> : <span className="font-mono">{p.key}</span>}
                  </span>
                  <span className="text-[var(--text-muted)]">{p.name}</span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {fmtNum(v, 4)}
                    {p.unit ? ` ${p.unit}` : ""}
                  </span>
                  {changed && (
                    <span className="apple-label text-[9px] font-semibold uppercase text-[var(--accent)]">edited</span>
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
