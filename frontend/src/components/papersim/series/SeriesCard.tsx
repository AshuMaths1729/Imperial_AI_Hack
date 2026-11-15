"use client";

import React from "react";
import { Activity, Lightbulb, Sigma, Timer, TrendingDown, TrendingUp, Waves } from "lucide-react";
import { RichText } from "../../math/MathTex";
import type { SeriesDoc } from "../../../types/scholartwin";
import { LineChart } from "./LineChart";
import { atX, fmtNum, fmtPct, fmtSigned, withUnit, type AxisLabel } from "./format";
import { SHAPE_LABEL, seriesInsights } from "./insights";
import { SeriesSwatch, stagger } from "./kit";
import type { SeriesStats } from "./stats";

export interface SeriesView {
  name: string;
  color: string;
  dash?: string;
  y: number[];
  stats: SeriesStats | null;
  doc?: SeriesDoc;
}

function Stat({ label, value, sub, i }: { label: string; value: string; sub?: string; i: number }) {
  return (
    <div
      className="st-rise min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2"
      style={stagger(i, 35, 120)}
    >
      <div className="text-[10px] font-medium text-[var(--text-muted)]">{label}</div>
      <div className="break-all font-mono text-sm font-semibold text-[var(--text-primary)]">{value}</div>
      {sub && <div className="break-words text-[10px] leading-snug text-[var(--text-muted)]"><RichText text={sub} /></div>}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
      <span className="ml-auto font-mono text-[11px] font-semibold text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

export function SeriesCard({
  view,
  x,
  xAxis,
  yLabel,
  index,
}: {
  view: SeriesView;
  x: number[];
  xAxis: AxisLabel;
  yLabel: string;
  index: number;
}) {
  const s = view.stats;
  const xu = (v: number) => withUnit(fmtNum(v), xAxis.unit);
  const span = s ? s.x1 - s.x0 : 0;

  return (
    <article
      // overflow-hidden only rounds the identity rail + hover sheen; nothing inside extends past the padding.
      className="st-fade-up apple-card st-sheen relative min-w-0 overflow-hidden rounded-2xl border p-4 sm:p-5"
      style={stagger(index, 90, 180)}
      aria-label={`${view.name} analysis`}
    >
      {/* Identity rail: series colour carries identity, text stays in text tokens */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: view.color }} />

      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <SeriesSwatch color={view.color} dash={view.dash} width={26} />
            <h3 className="apple-heading min-w-0 break-words text-base font-semibold text-[var(--text-primary)]"><RichText text={view.name} /></h3>
          </div>
          {view.doc?.meaning && (
            <div className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">
              <RichText text={view.doc.meaning} />
            </div>
          )}
        </div>
        {s && (
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
            {s.shape === "increasing" ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : s.shape === "decreasing" ? (
              <TrendingDown className="h-3.5 w-3.5" />
            ) : s.shape === "oscillating" ? (
              <Waves className="h-3.5 w-3.5" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
            {SHAPE_LABEL[s.shape]}
          </span>
        )}
      </header>

      {view.doc?.how_to_read && (
        <div className="mt-3 flex gap-2 rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
          <div className="text-xs leading-relaxed text-[var(--text-primary)]">
            <span className="font-semibold">How to read it: </span>
            <RichText text={view.doc.how_to_read} />
          </div>
        </div>
      )}

      {!s ? (
        <div className="mt-4 text-xs text-[var(--text-muted)]">No finite data points in this series.</div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-2">
              <LineChart
                x={x}
                series={[{ name: view.name, color: view.color, dash: view.dash, y: view.y }]}
                height={170}
                compact
                wash
                xLabel={xAxis.name}
                ariaLabel={`${view.name} over ${xAxis.name}, from ${fmtNum(s.initial)} to ${fmtNum(s.final)}`}
                markers={[
                  { x: s.maxX, y: s.max, color: view.color, label: "max" },
                  ...(s.minIdx !== s.maxIdx ? [{ x: s.minX, y: s.min, color: view.color, label: "min" }] : []),
                ]}
                vRules={s.thresholds
                  .filter((t) => t.id === "half" && t.x !== null)
                  .map((t) => ({ x: t.x as number, label: "50%" }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              <Stat i={0} label="Initial" value={fmtNum(s.initial)} sub={atX(xAxis, s.x0)} />
              <Stat i={1} label="Final" value={fmtNum(s.final)} sub={atX(xAxis, s.x1)} />
              <Stat
                i={2}
                label="Net change"
                value={fmtSigned(s.net)}
                sub={s.netPct !== null ? fmtPct(s.netPct) : "from 0"}
              />
              <Stat i={3} label="Mean" value={fmtNum(s.mean)} sub={`σ ${fmtNum(s.std)}`} />
              <Stat i={4} label="Maximum" value={fmtNum(s.max)} sub={`at ${xu(s.maxX)}`} />
              <Stat i={5} label="Minimum" value={fmtNum(s.min)} sub={`at ${xu(s.minX)}`} />
              <Stat i={6} label="Range" value={fmtNum(s.range)} sub="max − min" />
              <Stat i={7} label="Area under curve" value={fmtNum(s.auc)} sub={`∫ ${yLabel || "y"} d${xAxis.name}`} />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* Thresholds: where on the x-range notable moments happen */}
            {s.thresholds.length > 0 && (
              <div>
                <div className="apple-label mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                  <Timer className="h-3.5 w-3.5" /> Milestones along {xAxis.name}
                </div>
                <ul className="space-y-2">
                  {s.thresholds.map((t, i) => {
                    const pos = t.x !== null && span > 0 ? (t.x - s.x0) / span : null;
                    return (
                      <li key={t.id} title={t.hint}>
                        <div className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="text-[var(--text-secondary)]">{t.label}</span>
                          <span className="font-mono font-semibold text-[var(--text-primary)]">
                            {t.x !== null ? xu(t.x) : <span className="font-sans font-normal text-[var(--text-muted)]">{t.never ?? "Not reached"}</span>}
                          </span>
                        </div>
                        <div className="relative mt-1 h-1.5 rounded-full bg-[var(--bg-surface-muted)]">
                          {pos !== null && (
                            <>
                              <span
                                className="st-grow-x absolute inset-y-0 left-0 rounded-full"
                                style={{
                                  width: `${Math.max(0, Math.min(1, pos)) * 100}%`,
                                  background: view.color,
                                  opacity: 0.35,
                                  ...stagger(i, 70, 250),
                                }}
                              />
                              <span
                                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-surface-solid)]"
                                style={{ left: `${Math.max(0, Math.min(1, pos)) * 100}%`, background: view.color }}
                              />
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div>
              <div className="apple-label mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                <Sigma className="h-3.5 w-3.5" /> Shape
              </div>
              <div className="divide-y divide-[var(--border-subtle)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1">
                <Fact icon={TrendingUp} label="Local peaks" value={String(s.peaks.length)} />
                <Fact icon={TrendingDown} label="Local troughs" value={String(s.troughs.length)} />
                {s.zeroCrossings > 0 && <Fact icon={Activity} label="Zero crossings" value={String(s.zeroCrossings)} />}
                {s.period !== null && <Fact icon={Waves} label="Mean period" value={xu(s.period)} />}
                {s.fit && (
                  <>
                    <Fact
                      icon={Timer}
                      label={
                        s.fit.basis === "envelope"
                          ? "Amplitude half-life"
                          : s.fit.kind === "decay"
                            ? "Half-life"
                            : "Doubling scale"
                      }
                      value={xu(s.fit.half)}
                    />
                    <Fact icon={Sigma} label="e-folding scale τ" value={xu(s.fit.tau)} />
                    <Fact icon={Sigma} label="Exponential fit R²" value={s.fit.r2.toFixed(3)} />
                  </>
                )}
              </div>
            </div>
          </div>

          <ul className="mt-4 space-y-1 border-t border-[var(--border-subtle)] pt-3">
            {seriesInsights(view.name, s, xAxis).map((line, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]" />
                <RichText text={line} />
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
