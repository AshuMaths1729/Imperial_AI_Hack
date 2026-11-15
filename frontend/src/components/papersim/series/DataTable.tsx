"use client";

import React, { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Download, Table2 } from "lucide-react";
import { fmtNum, slugify } from "./format";
import { CopyButton, SeriesSwatch, stagger } from "./kit";
import { sampleIndices } from "./stats";
import type { SeriesView } from "./SeriesCard";
import { RichText } from "../../math/MathTex";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(xLabel: string, x: number[], views: SeriesView[], rows?: number[]): string {
  const idx = rows ?? x.map((_, i) => i);
  const head = [xLabel || "x", ...views.map((v) => v.name)].map(csvCell).join(",");
  const body = idx.map((i) =>
    [x[i], ...views.map((v) => (Number.isFinite(v.y[i]) ? v.y[i] : ""))].map(csvCell).join(","),
  );
  return [head, ...body].join("\n");
}

export function DataTable({
  x,
  xLabel,
  views,
  fileTitle,
}: {
  x: number[];
  xLabel: string;
  views: SeriesView[];
  fileTitle: string;
}) {
  const [showAll, setShowAll] = useState(false);

  const extremes = useMemo(() => {
    const map = new Map<number, { max: string[]; min: string[] }>();
    for (const v of views) {
      if (!v.stats) continue;
      const add = (i: number, kind: "max" | "min") => {
        const e = map.get(i) ?? { max: [], min: [] };
        e[kind].push(v.name);
        map.set(i, e);
      };
      add(v.stats.maxIdx, "max");
      add(v.stats.minIdx, "min");
    }
    return map;
  }, [views]);

  const rows = useMemo(
    () => (showAll ? x.map((_, i) => i) : sampleIndices(x.length, 20, [...extremes.keys()])),
    [showAll, x, extremes],
  );

  const download = () => {
    const blob = new Blob([buildCsv(xLabel, x, views)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(fileTitle)}-series.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="st-fade-up apple-card min-w-0 rounded-2xl border p-4" style={stagger(0, 0, 260)} aria-labelledby="data-heading">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 id="data-heading" className="apple-heading flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
            <Table2 className="h-4 w-4 text-[var(--accent)]" /> Data table
          </h2>
          <p className="text-[11px] text-[var(--text-muted)]">
            {showAll
              ? `All ${x.length} samples`
              : `${rows.length} of ${x.length} samples: evenly spaced, plus every series' extremes`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          aria-pressed={showAll}
          className="apple-press apple-focus whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]"
        >
          {showAll ? "Show sample" : `Show all ${x.length}`}
        </button>
        <CopyButton label="Copy CSV" text={() => buildCsv(xLabel, x, views)} title="Copy every sample as CSV" />
        {/* The view's one tinted primary action (PaperSim hue). */}
        <button
          type="button"
          onClick={download}
          style={{ "--tint": "var(--status-support)" } as React.CSSProperties}
          className="apple-tint apple-press apple-focus inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1 text-[11px] font-semibold"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      {/* Solid surface: crisp rows, and the sticky header hides rows scrolling beneath it. */}
      <div className="mt-3 max-h-[26rem] overflow-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-solid)]">
        <table className="w-full border-collapse text-left text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead className="sticky top-0 z-[1] bg-[var(--bg-surface-solid)] shadow-[inset_0_-1px_0_var(--border-subtle)]">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold text-[var(--text-muted)]">#</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-semibold text-[var(--text-secondary)]">{xLabel || "x"}</th>
              {views.map((v) => (
                <th key={v.name} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold text-[var(--text-secondary)]">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <SeriesSwatch color={v.color} dash={v.dash} width={16} />
                    <RichText text={v.name} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const ext = extremes.get(i);
              return (
                <tr key={i} className="border-t border-[var(--border-subtle)] hover:bg-[var(--accent-soft)]">
                  <td className="px-3 py-1.5 font-mono text-[var(--text-muted)]">{i}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[var(--text-primary)]">{fmtNum(x[i], 4)}</td>
                  {views.map((v) => {
                    const isMax = ext?.max.includes(v.name);
                    const isMin = ext?.min.includes(v.name);
                    return (
                      <td
                        key={v.name}
                        className={`whitespace-nowrap px-3 py-1.5 text-right font-mono ${
                          isMax || isMin ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                        }`}
                      >
                        <span className="inline-flex items-center justify-end gap-1">
                          {isMax && (
                            <ArrowUpToLine className="h-3 w-3 text-[var(--text-muted)]" aria-label={`maximum of ${v.name}`} />
                          )}
                          {isMin && (
                            <ArrowDownToLine className="h-3 w-3 text-[var(--text-muted)]" aria-label={`minimum of ${v.name}`} />
                          )}
                          {fmtNum(v.y[i], 4)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1"><ArrowUpToLine className="h-3 w-3" /> series maximum</span>
        <span className="inline-flex items-center gap-1"><ArrowDownToLine className="h-3 w-3" /> series minimum</span>
        <span>CSV export contains full-precision values for every sample.</span>
      </p>
    </section>
  );
}
