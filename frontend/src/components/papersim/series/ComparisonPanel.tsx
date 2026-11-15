"use client";

import React, { useMemo, useState } from "react";
import { ArrowRightLeft, GitCompareArrows, Sparkles, Trophy } from "lucide-react";
import { LineChart } from "./LineChart";
import { atX, fmtNum, fmtSigned, type AxisLabel } from "./format";
import { comparisonInsights } from "./insights";
import { SeriesSwatch, stagger } from "./kit";
import { compareSeries } from "./stats";
import type { SeriesView } from "./SeriesCard";
import { RichText } from "../../math/MathTex";

function Tile({ label, value, sub, i }: { label: string; value: string; sub?: string; i: number }) {
  return (
    <div
      className="st-rise min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2"
      style={stagger(i, 40, 100)}
    >
      <p className="text-[10px] font-medium text-[var(--text-muted)]">{label}</p>
      <p className="break-all font-mono text-sm font-semibold text-[var(--text-primary)]">{value}</p>
      {sub && <p className="break-words text-[10px] leading-snug text-[var(--text-muted)]"><RichText text={sub} /></p>}
    </div>
  );
}

function PairSelect({
  value,
  onChange,
  views,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  views: SeriesView[];
  label: string;
}) {
  const v = views.find((s) => s.name === value);
  return (
    <label className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] py-1 pl-3 pr-1.5 focus-within:border-[var(--accent-border)]">
      <span className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">{label}</span>
      {v && <SeriesSwatch color={v.color} dash={v.dash} width={18} />}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="apple-focus min-w-0 flex-1 cursor-pointer rounded-full bg-transparent py-1 pr-1 text-xs font-medium text-[var(--text-primary)] outline-none"
      >
        {views.map((s) => (
          <option key={s.name} value={s.name} className="bg-[var(--bg-surface-solid)] text-[var(--text-primary)]">
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ComparisonPanel({
  views,
  x,
  xAxis,
  xLabel,
}: {
  views: SeriesView[];
  x: number[];
  xAxis: AxisLabel;
  xLabel: string;
}) {
  const [picked, setPicked] = useState<[string, string] | null>(null);
  const names = views.map((v) => v.name);
  // Derive a valid pair (series names can change when the simulation is re-run).
  const pair: [string, string] =
    picked && names.includes(picked[0]) && names.includes(picked[1]) && picked[0] !== picked[1]
      ? picked
      : [names[0], names[1]];
  const A = views.find((v) => v.name === pair[0])!;
  const B = views.find((v) => v.name === pair[1])!;

  const cmp = useMemo(() => compareSeries(x, A.y, B.y), [x, A.y, B.y]);

  const ranking = useMemo(
    () =>
      views
        .filter((v) => v.stats)
        .map((v) => ({ v, final: v.stats!.final }))
        .sort((p, q) => q.final - p.final),
    [views],
  );

  const setA = (name: string) => setPicked([name, name === pair[1] ? pair[0] : pair[1]]);
  const setB = (name: string) => setPicked([name === pair[0] ? pair[1] : pair[0], name]);

  return (
    <section className="st-fade-up space-y-4" style={stagger(0, 0, 200)} aria-labelledby="compare-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="apple-label flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--accent)]">
            <GitCompareArrows className="h-3.5 w-3.5" /> Comparison
          </p>
          <h2 id="compare-heading" className="apple-heading mt-1 text-lg font-semibold text-[var(--text-primary)]">
            How the series differ
          </h2>
        </div>
      </div>

      {/* Overlay of every series */}
      <div className="apple-card min-w-0 rounded-2xl border p-4">
        <p className="mb-2 text-xs font-semibold text-[var(--text-primary)]">All series, overlaid</p>
        <LineChart
          x={x}
          series={views.map((v) => ({ name: v.name, color: v.color, dash: v.dash, y: v.y }))}
          height={280}
          legend
          xLabel={xLabel}
          ariaLabel={`Overlay of ${views.length} series against ${xAxis.name}`}
        />
        {ranking.length >= 2 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              <Trophy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              Ranking at <RichText text={atX(xAxis, x[x.length - 1] ?? 0)} />
            </span>
            {ranking.map(({ v, final }, i) => (
              <span
                key={v.name}
                className="st-rise flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-0.5 text-[11px]"
                style={stagger(i, 60, 300)}
                title={v.name}
              >
                <span className="font-mono text-[var(--text-muted)]">{i + 1}</span>
                <SeriesSwatch color={v.color} dash={v.dash} width={16} />
                <RichText className="min-w-0 truncate text-[var(--text-secondary)]" text={v.name} />
                <span className="font-mono font-semibold text-[var(--text-primary)]">{fmtNum(final)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Pairwise */}
      <div className="apple-card min-w-0 rounded-2xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs font-semibold text-[var(--text-primary)]">Head to head</p>
          <PairSelect label="A" value={pair[0]} onChange={setA} views={views} />
          <button
            type="button"
            onClick={() => setPicked([pair[1], pair[0]])}
            title="Swap A and B"
            aria-label="Swap A and B"
            className="apple-press apple-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
          </button>
          <PairSelect label="B" value={pair[1]} onChange={setB} views={views} />
        </div>

        {!cmp ? (
          <p className="mt-4 text-xs text-[var(--text-muted)]">Not enough overlapping points to compare.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
                <p className="text-[11px] font-semibold text-[var(--text-primary)]">Difference A − B</p>
                <p className="mb-1 text-[10px] text-[var(--text-muted)]">
                  Shaded with A&apos;s colour where A leads, B&apos;s where B leads
                </p>
                <LineChart
                  x={cmp.x}
                  series={[{ name: `${A.name} − ${B.name}`, color: "var(--text-secondary)", y: cmp.diff }]}
                  height={200}
                  compact
                  diverging={{ pos: A.color, neg: B.color }}
                  hRules={[{ y: 0, label: "equal" }]}
                  vRules={[{ x: cmp.maxAbsDiffX, label: "max gap" }]}
                  ariaLabel={`Difference between ${A.name} and ${B.name}`}
                />
              </div>
              <div className="min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
                <p className="text-[11px] font-semibold text-[var(--text-primary)]">Ratio A ÷ B</p>
                <p className="mb-1 text-[10px] text-[var(--text-muted)]">Above 1 means A is larger by that factor</p>
                {cmp.ratioValid ? (
                  <LineChart
                    x={cmp.x}
                    series={[{ name: `${A.name} ÷ ${B.name}`, color: "var(--text-secondary)", y: cmp.ratio }]}
                    height={200}
                    compact
                    hRules={[{ y: 1, label: "1×" }]}
                    ariaLabel={`Ratio of ${A.name} to ${B.name}`}
                  />
                ) : (
                  <div className="flex h-[200px] items-center justify-center px-6 text-center text-[11px] text-[var(--text-muted)]">
                    The ratio is undefined over much of the range because {B.name} sits at or crosses zero; the
                    difference curve is the better comparison here.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Tile i={0} label="Final gap (A − B)" value={fmtSigned(cmp.finalGap)} sub={`start ${fmtSigned(cmp.initialGap)}`} />
              <Tile i={1} label="Largest gap" value={fmtNum(cmp.maxAbsDiff)} sub={`at ${atX(xAxis, cmp.maxAbsDiffX)}`} />
              <Tile i={2} label="Mean gap" value={fmtSigned(cmp.meanDiff)} sub="averaged over x" />
              <Tile i={3} label="Area between" value={fmtNum(cmp.areaBetween)} sub="∫ |A − B| dx" />
              <Tile
                i={4}
                label="Crossings"
                value={String(cmp.crossings.length)}
                sub={cmp.crossings.length ? `first at ${fmtNum(cmp.crossings[0])}` : "never cross"}
              />
              <Tile i={5} label="Correlation r" value={cmp.r === null ? "—" : cmp.r.toFixed(3)} sub="shape similarity" />
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-primary)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" /> What this means
              </p>
              <ul className="space-y-1">
                {comparisonInsights(A.name, B.name, cmp, xAxis).map((line, i) => (
                  <li
                    key={i}
                    className="st-rise flex gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"
                    style={stagger(i, 70, 200)}
                  >
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                    <RichText text={line} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
