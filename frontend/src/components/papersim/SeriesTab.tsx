"use client";

import React, { useMemo } from "react";
import { LineChart as LineChartIcon } from "lucide-react";
import type { PaperSimTabProps } from "./types";
import { ComparisonPanel } from "./series/ComparisonPanel";
import { DataTable } from "./series/DataTable";
import { parseAxisLabel } from "./series/format";
import { seriesColor, seriesDash } from "./series/kit";
import { SeriesCard, type SeriesView } from "./series/SeriesCard";
import { SeriesHeader } from "./series/SeriesHeader";
import { computeSeriesStats } from "./series/stats";

const norm = (s: string) => s.trim().toLowerCase();

/** "Series Breakdown" tab: live statistics, milestones, comparisons and raw data. */
export function SeriesTab({ simulation, paramValues }: PaperSimTabProps) {
  const x = simulation.x;
  const xAxis = useMemo(() => parseAxisLabel(simulation.x_label), [simulation.x_label]);

  const views: SeriesView[] = useMemo(() => {
    const docs = new Map((simulation.docs?.series ?? []).map((d) => [norm(d.name), d]));
    return simulation.series.map((s, i) => ({
      name: s.name,
      color: seriesColor(s.color, i),
      dash: seriesDash(i),
      y: s.y,
      stats: computeSeriesStats(x, s.y),
      doc: docs.get(norm(s.name)),
    }));
  }, [simulation.series, simulation.docs, x]);

  const title = simulation.sim_title || simulation.paper_title || "simulation";

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
      <SeriesHeader simulation={simulation} paramValues={paramValues} />

      {views.length === 0 ? (
        <div className="st-fade-up flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--border-strong)] p-10 text-center">
          <LineChartIcon className="h-6 w-6 text-[var(--text-muted)]" />
          <p className="text-sm font-medium text-[var(--text-primary)]">No output series yet</p>
          <p className="text-xs text-[var(--text-muted)]">Run the simulation to see its curves analysed here.</p>
        </div>
      ) : (
        <>
          <section className="space-y-4" aria-label="Per-series analysis">
            {views.map((v, i) => (
              <SeriesCard
                key={v.name}
                view={v}
                x={x}
                xAxis={xAxis}
                yLabel={simulation.y_label}
                index={i}
              />
            ))}
          </section>

          {views.length >= 2 && (
            <ComparisonPanel views={views} x={x} xAxis={xAxis} xLabel={simulation.x_label} />
          )}

          <DataTable x={x} xLabel={simulation.x_label} views={views} fileTitle={title} />
        </>
      )}
    </div>
  );
}
