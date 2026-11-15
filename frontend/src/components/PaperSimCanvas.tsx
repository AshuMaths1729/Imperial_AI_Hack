"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Download, Pin, RotateCcw, SlidersHorizontal, Table2, X } from "lucide-react";
import type { SimulationPayload, UIAnnotation } from "../types/scholartwin";
import { RichText, Tex } from "./math/MathTex";
import { formatParam, paramsLatex, slug, toCsv } from "./papersim/simulation/format";
import { useReducedMotion, usePopover, useTweenedFrame } from "./papersim/simulation/hooks";
import { ParamCard } from "./papersim/simulation/ParamCard";
import { PresetBar, defaultsOf, matches } from "./papersim/simulation/PresetBar";
import { Readouts } from "./papersim/simulation/Readouts";
import {
  DataTable,
  Legend,
  SimChart,
  buildFrame,
  type PinnedRun,
  type TrailRun,
} from "./papersim/simulation/SimChart";
import { SweepPanel, useSweep } from "./papersim/simulation/SweepPanel";

interface PaperSimCanvasProps {
  simulation: SimulationPayload;
  paramValues: Record<string, number>;
  annotations: UIAnnotation[];
  onParamChange: (key: string, val: number) => void;
  onSetParams: (next: Record<string, number>) => void;
}

const MAX_PINS = 3;
const MAX_TRAIL = 24;

function ToolButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={`apple-press apple-focus flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

/** The Interactive Simulation workspace: scenarios, explained sliders, a live chart and tools. */
export function PaperSimCanvas({
  simulation,
  paramValues,
  annotations,
  onParamChange,
  onSetParams,
}: PaperSimCanvasProps) {
  const reducedMotion = useReducedMotion();
  const docs = simulation.docs;
  const params = simulation.params;

  const paramDocs = useMemo(() => new Map((docs?.params ?? []).map((d) => [d.key, d])), [docs]);
  const seriesDocs = useMemo(
    () => new Map((docs?.series ?? []).map((d) => [d.name.trim().toLowerCase(), d])),
    [docs]
  );
  const names = useMemo(() => simulation.series.map((s) => s.name), [simulation.series]);

  const values = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of params) out[p.key] = paramValues[p.key] ?? p.default_val;
    return out;
  }, [params, paramValues]);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [emphasis, setEmphasis] = useState<string | null>(null);
  const [logY, setLogY] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [pins, setPins] = useState<PinnedRun[]>([]);
  const [hotPin, setHotPin] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailRun[]>([]);
  const [keepTrace, setKeepTrace] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [sweepKey, setSweepKey] = useState<string>(params[0]?.key ?? "");
  const pinCounter = useRef(0);
  const { open: howToOpen, setOpen: setHowToOpen, ref: howToRef } = usePopover<HTMLDivElement>();

  /* ---- sweep (refs give the interval the freshest values without re-subscribing) ---- */
  const latest = useRef({ values, simulation, keepTrace });
  useEffect(() => {
    latest.current = { values, simulation, keepTrace };
  }, [values, simulation, keepTrace]);

  const apply = useCallback(
    (key: string, value: number) => onSetParams({ ...latest.current.values, [key]: value }),
    [onSetParams]
  );
  const capture = useCallback((t: number) => {
    const { simulation: sim, keepTrace: keep } = latest.current;
    if (!keep) return;
    setTrail((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.x === sim.x && last.series.length && last.series[0].y === sim.series[0]?.y) return prev;
      return [...prev, { t, x: sim.x, series: sim.series.map((s) => ({ name: s.name, y: s.y })) }].slice(-MAX_TRAIL);
    });
  }, []);
  const onSweepStart = useCallback(() => setTrail([]), []);
  const sweep = useSweep({ apply, capture, onStart: onSweepStart, intervalMs: reducedMotion ? 700 : 260 });

  const setOne = (key: string, val: number) => {
    if (sweep.running) sweep.stop();
    onParamChange(key, val);
  };
  const setMany = (next: Record<string, number>) => {
    if (sweep.running) sweep.stop();
    onSetParams(next);
  };

  /* ---- frames ---- */
  const extras = useMemo(() => [...pins, ...trail], [pins, trail]);
  const allPositive = useMemo(() => {
    let any = false;
    const ok = [{ x: simulation.x, series: simulation.series }, ...extras].every((run) =>
      run.series.every(
        (s) =>
          hidden.has(s.name) ||
          s.y.every((v) => {
            if (!Number.isFinite(v)) return true;
            any = true;
            return v > 0;
          })
      )
    );
    return ok && any;
  }, [simulation.x, simulation.series, extras, hidden]);
  const effectiveLog = logY && allPositive;

  const target = useMemo(
    () => buildFrame(simulation.x, simulation.series, (n) => !hidden.has(n), effectiveLog, extras),
    [simulation.x, simulation.series, hidden, effectiveLog, extras]
  );
  const shown = useTweenedFrame(target, !reducedMotion);

  /* ---- pins ---- */
  const defaults = useMemo(() => defaultsOf(params), [params]);
  const lastPin = pins[pins.length - 1] ?? null;
  const alreadyPinned = pins.some((p) => matches(p.params, values, params) && p.x === simulation.x);

  const pinRun = () => {
    pinCounter.current += 1;
    const changed = params.filter((p) => !matches({ [p.key]: values[p.key] }, { [p.key]: defaults[p.key] }, [p]));
    const shownKeys = (changed.length ? changed : params).slice(0, 3).map((p) => p.key);
    let latex = changed.length === 0 && params.length > 3 ? "\\text{paper defaults}" : paramsLatex(values, params, paramDocs, shownKeys);
    if (changed.length > 3) latex += ",\\ \\dots";
    const pin: PinnedRun = {
      id: `pin-${pinCounter.current}`,
      n: pinCounter.current,
      latex,
      params: { ...values },
      x: simulation.x,
      series: simulation.series.map((s) => ({ name: s.name, y: s.y })),
    };
    setPins((prev) => [...prev, pin].slice(-MAX_PINS));
  };

  const exportCsv = () => {
    const csv = toCsv(simulation.x_label, simulation.x, simulation.series);
    const tag = params.map((p) => `${p.key}-${formatParam(values[p.key], p)}`).join("_");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(simulation.sim_title || simulation.y_label || "simulation")}${tag ? `_${slug(tag)}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toggleSeries = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const title = simulation.sim_title?.trim() || `${simulation.y_label} vs ${simulation.x_label}`;
  const fromPaper = simulation.paper_title && simulation.paper_title !== title ? simulation.paper_title : null;
  const callouts = annotations.filter((a) => a.type === "callout_box");
  const hasHowTo = Boolean(docs?.x_meaning || docs?.y_meaning || docs?.series?.some((s) => s.how_to_read));
  const empty = simulation.x.length === 0 || simulation.series.length === 0;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-4 p-4 md:p-5">
      {params.length > 0 && (
        <PresetBar params={params} presets={docs?.presets ?? []} values={values} onApply={setMany} />
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
        {/* ---------------- chart column ---------------- */}
        <section className="flex min-w-0 flex-col gap-4">
          <div
            className="st-fade-up relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)] md:p-5"
            style={{ animationDelay: "60ms" }}
          >
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="apple-heading text-base font-semibold text-[var(--text-primary)] md:text-lg">
                  <RichText text={title} />
                </h2>
                {fromPaper && (
                  <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]" title={fromPaper}>
                    Model from <span className="italic">{fromPaper}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {hasHowTo && (
                  <div ref={howToRef} className="relative">
                    <ToolButton active={howToOpen} title="How to read this chart" onClick={() => setHowToOpen((o) => !o)}>
                      <BookOpen className="h-3.5 w-3.5" />
                      How to read
                    </ToolButton>
                    {howToOpen && (
                      <div className="apple-glass-elevated apple-materialize absolute right-0 top-full z-30 mt-2 w-[min(22rem,85vw)] space-y-2 rounded-2xl border p-3.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {docs?.x_meaning && (
                          <p>
                            <span className="font-semibold text-[var(--text-primary)]">Horizontal · </span>
                            <RichText text={docs.x_meaning} />
                          </p>
                        )}
                        {docs?.y_meaning && (
                          <p>
                            <span className="font-semibold text-[var(--text-primary)]">Vertical · </span>
                            <RichText text={docs.y_meaning} />
                          </p>
                        )}
                        {docs?.series
                          ?.filter((s) => s.how_to_read)
                          .map((s) => (
                            <p key={s.name}>
                              <span className="font-semibold text-[var(--text-primary)]"><RichText text={s.name} /> · </span>
                              <RichText text={s.how_to_read ?? ""} />
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                <ToolButton
                  active={effectiveLog}
                  disabled={!allPositive}
                  title={allPositive ? "Toggle a logarithmic y-axis" : "Log scale needs every plotted value to be positive"}
                  onClick={() => setLogY((v) => !v)}
                >
                  <span className="font-mono text-[10px] font-bold">log</span>y
                </ToolButton>
                <ToolButton active={showTable} title="Show the values as a table" onClick={() => setShowTable((v) => !v)}>
                  <Table2 className="h-3.5 w-3.5" />
                  Table
                </ToolButton>
                <ToolButton
                  disabled={empty || alreadyPinned}
                  title={alreadyPinned ? "This run is already pinned" : "Keep this run as a ghost to compare against"}
                  onClick={pinRun}
                >
                  <Pin className="h-3.5 w-3.5" />
                  Pin run
                </ToolButton>
                <ToolButton disabled={empty} title="Download the current series as CSV" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </ToolButton>
              </div>
            </header>

            {simulation.equation_latex?.trim() && (
              <div className="mt-3 rounded-xl bg-[var(--bg-surface-muted)] px-3 py-1 text-[var(--text-primary)]">
                <Tex latex={simulation.equation_latex} display />
              </div>
            )}

            <div className="mt-3">
              <Legend
                names={names}
                docs={seriesDocs}
                hidden={hidden}
                onToggle={toggleSeries}
                onEmphasis={setEmphasis}
              />
            </div>

            <div className="mt-3">
              {empty ? (
                <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] text-xs text-[var(--text-muted)]">
                  The simulation returned no data for these parameters.
                </div>
              ) : (
                <SimChart
                  frame={shown}
                  exact={target}
                  names={names}
                  xLabel={simulation.x_label}
                  yLabel={simulation.y_label}
                  hidden={hidden}
                  emphasis={emphasis}
                  pins={pins}
                  highlightedPin={hotPin}
                  trail={trail}
                  hoverX={hoverX}
                  onHoverX={setHoverX}
                  callouts={callouts}
                  busy={sweep.running}
                />
              )}
            </div>

            {pins.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
                <span className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">Pinned</span>
                {pins.map((p) => (
                  <div
                    key={p.id}
                    onMouseEnter={() => setHotPin(p.id)}
                    onMouseLeave={() => setHotPin(null)}
                    onFocus={() => setHotPin(p.id)}
                    onBlur={() => setHotPin(null)}
                    className={`st-fade-up flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[11px] ${
                      hotPin === p.id
                        ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]"
                    }`}
                  >
                    <span className="font-semibold text-[var(--text-primary)]">Pin {p.n}</span>
                    <span className="text-[var(--text-secondary)]">
                      <Tex latex={p.latex} />
                    </span>
                    <button
                      type="button"
                      onClick={() => setMany({ ...defaults, ...p.params })}
                      title="Restore these parameters"
                      aria-label={`Restore parameters of pin ${p.n}`}
                      className="apple-press apple-focus ml-1 rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--accent)]"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPins((prev) => prev.filter((q) => q.id !== p.id));
                        setHotPin(null);
                      }}
                      aria-label={`Remove pin ${p.n}`}
                      className="apple-press apple-focus rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--status-contradict)]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <span className="text-[10px] text-[var(--text-muted)]">Faint curves behind the live ones; hover a pin to spotlight it.</span>
              </div>
            )}

            {showTable && !empty && (
              <div className="mt-3">
                <DataTable frame={target} names={names} hidden={hidden} xLabel={simulation.x_label} />
              </div>
            )}
          </div>

          {!empty && (
            <Readouts
              frame={shown}
              exact={target}
              names={names}
              hidden={hidden}
              xLabel={simulation.x_label}
              hoverX={hoverX}
              pin={lastPin}
              onEmphasis={setEmphasis}
            />
          )}
        </section>

        {/* ---------------- controls column ---------------- */}
        <aside className="flex min-w-0 flex-col gap-3" aria-label="Simulation parameters">
          <div className="flex items-center justify-between px-1">
            <h3 className="apple-label flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--text-muted)]">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Parameters
            </h3>
            <span className="text-[11px] text-[var(--text-muted)]">{params.length} adjustable</span>
          </div>
          {params.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border-strong)] p-4 text-xs text-[var(--text-muted)]">
              This model has no adjustable parameters.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {params.map((p, i) => (
                <ParamCard
                  key={p.key}
                  param={p}
                  doc={paramDocs.get(p.key)}
                  value={values[p.key]}
                  sweeping={sweep.running && sweep.key === p.key}
                  onChange={(v) => setOne(p.key, v)}
                  style={{ animationDelay: `${100 + i * 55}ms` }}
                />
              ))}
            </div>
          )}
          {params.length > 0 && (
            <SweepPanel
              params={params}
              docs={paramDocs}
              selected={sweepKey}
              onSelect={setSweepKey}
              sweep={sweep}
              values={values}
              keepTrace={keepTrace}
              onKeepTrace={setKeepTrace}
              traceCount={trail.length}
              onClearTrace={() => setTrail([])}
              reducedMotion={reducedMotion}
              style={{ animationDelay: `${100 + params.length * 55}ms` }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
