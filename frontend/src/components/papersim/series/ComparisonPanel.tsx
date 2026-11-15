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
      <p className="text-[10.5px] text-[var(--text-muted)]">{label}</p>
      <p className="break-all font-mono text-sm font-medium tabular-nums text-[var(--text-primary)]">{value}</p>
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

  // The overlay's one legend, ranked by final value (series without finite data go last).
  const ranking = useMemo(
    () =>
      [
        ...views
          .filter((v) => v.stats)
          .map((v) => ({ v, final: v.stats!.final as number | null }))
          .sort((p, q) => (q.final as number) - (p.final as number)),
        ...views.filter((v) => !v.stats).map((v) => ({ v, final: null })),
      ],
    [views],
  );
  const ranked = ranking.filter((r) => r.final !== null).length >= 2;

  const setA = (name: string) => setPicked([name, name === pair[1] ? pair[0] : pair[1]]);
  const setB = (name: string) => setPicked([name === pair[0] ? pair[1] : pair[0], name]);

  return (
    <section className="st-fade-up space-y-4 ![animation-fill-mode:backwards]" style={stagger(0, 0, 200)} aria-labelledby="compare-heading">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="on-scene-soft flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em]">
            <GitCompareArrows className="h-3.5 w-3.5" /> Comparison
          </p>
          <h2 id="compare-heading" className="on-scene st-display mt-1.5 text-[26px]">
            How the series differ
          </h2>
        </div>
      </div>

      {/* Overlay of every series. Its one legend is ranked by final value, so the series are
          named once here (the ranking used to repeat them in a second row). */}
      <div className="apple-card st-sheen relative min-w-0 overflow-hidden rounded-[22px] border p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[17px] font-normal tracking-[-0.015em] text-[var(--text-primary)]">All series, overlaid</h3>
          {ranked && (
            <p className="flex items-start gap-1.5 text-[11px] text-[var(--text-muted)]">
              <Trophy className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Ranked by value at <RichText text={atX(xAxis, x[x.length - 1] ?? 0)} />
              </span>
            </p>
          )}
        </div>
        <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Series, ranked by final value">
          {ranking.map(({ v, final }, i) => (
            <li
              key={v.name}
              className="st-rise flex min-w-0 max-w-full items-center gap-1.5 text-xs"
              style={stagger(i, 60, 300)}
              title={v.name}
            >
              {ranked && <span className="font-mono text-[11px] text-[var(--text-muted)]">{final === null ? "–" : i + 1}</span>}
              <SeriesSwatch color={v.color} dash={v.dash} width={18} />
              <RichText className="min-w-0 truncate text-[var(--text-secondary)]" text={v.name} />
              <span className="font-mono font-medium tabular-nums text-[var(--text-primary)]">{fmtNum(final)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3">
          <LineChart
            x={x}
            series={views.map((v) => ({ name: v.name, color: v.color, dash: v.dash, y: v.y }))}
            height={280}
            xLabel={xLabel}
            ariaLabel={`Overlay of ${views.length} series against ${xAxis.name}`}
          />
        </div>
      </div>

      {/* Pairwise */}
      <div className="apple-card st-sheen relative min-w-0 overflow-hidden rounded-[22px] border p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-[17px] font-normal tracking-[-0.015em] text-[var(--text-primary)]">Head to head</h3>
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
                <p className="text-xs font-medium text-[var(--text-primary)]">Difference A − B</p>
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
                <p className="text-xs font-medium text-[var(--text-primary)]">Ratio A ÷ B</p>
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
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
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
