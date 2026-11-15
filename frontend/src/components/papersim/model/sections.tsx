"use client";

import React from "react";
import { ArrowDown, ArrowUp, BookOpen, CornerDownRight, ExternalLink, MapPin, Quote, ShieldAlert, TriangleAlert } from "lucide-react";
import { RichText, Tex } from "../../math/MathTex";
import type { DerivationStep, EquationDoc, EquationVar, SimulationPayload } from "../../../types/scholartwin";
import { fmtNum } from "../series/format";
import { CopyButton, stagger } from "../series/kit";
import { eqAnchor, locLabel, paramAnchor, type ParamRow, type SourceGroup } from "./derive";
import { scrollToSection } from "./SectionNav";

const card = "apple-card min-w-0 rounded-2xl border";
/** Recessed well for display maths: Tex display blocks scroll sideways inside it, never clip. */
const mathWell = "min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]";

function SourceBadge({ label }: { label: string }) {
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
      <MapPin className="h-3 w-3 text-[var(--text-muted)]" />
      {label}
    </span>
  );
}

function QuoteBlock({ quote, where }: { quote: string; where?: string }) {
  return (
    <blockquote className="mt-3 flex gap-2 rounded-2xl border-l-2 border-[var(--accent-border)] bg-[var(--bg-surface-muted)] px-3 py-2">
      <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
      <div className="min-w-0">
        <div className="text-xs italic leading-relaxed text-[var(--text-secondary)]">
          <RichText text={quote} />
        </div>
        {where && <div className="mt-1 text-[10px] text-[var(--text-muted)]">Found in the paper, {where}</div>}
      </div>
    </blockquote>
  );
}

/* ------------------------------------------------------------------ 1. Overview */

export function OverviewBody({ sim, facts }: { sim: SimulationPayload; facts: { label: string; value: number }[] }) {
  const overview = sim.docs?.overview?.trim() || sim.summary?.trim();
  const citedModel = !!sim.sim_title && !!sim.paper_title && sim.sim_title.trim() !== sim.paper_title.trim();
  return (
    <div className={`${card} relative overflow-hidden p-5`}>
      <div aria-hidden className="apple-hero-glow pointer-events-none absolute inset-0" />
      <div className="relative">
        <div className="apple-display break-words text-xl font-semibold text-[var(--text-primary)]">
          {sim.sim_title || sim.paper_title || "Simulated model"}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {citedModel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-gap-border)] bg-[var(--status-gap-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--status-gap)]">
              <CornerDownRight className="h-3 w-3" /> Model cited in the paper
            </span>
          )}
          {sim.arxiv_id && (
            <a
              href={`https://arxiv.org/abs/${encodeURIComponent(sim.arxiv_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="apple-focus inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent)]"
            >
              arXiv:{sim.arxiv_id} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {citedModel && (
          <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            The simulation implements <span className="font-semibold text-[var(--text-primary)]">{sim.sim_title}</span>, a
            model discussed in <span className="font-semibold text-[var(--text-primary)]">{sim.paper_title}</span>, rather
            than a model the paper introduces itself.
          </div>
        )}
        {overview ? (
          <div className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--text-secondary)]">
            <RichText text={overview} />
          </div>
        ) : (
          <div className="mt-3 text-xs text-[var(--text-muted)]">No overview was extracted for this model.</div>
        )}
        {facts.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {facts.map((f, i) => (
              <div
                key={f.label}
                className="st-rise rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2"
                style={stagger(i, 50, 200)}
              >
                <dt className="text-[10px] text-[var(--text-muted)]">{f.label}</dt>
                <dd className="text-lg font-semibold text-[var(--text-primary)]">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 2. Key findings */

export function FindingsBody({ findings }: { findings: string[] }) {
  return (
    <ol className="grid gap-3 md:grid-cols-2">
      {findings.map((f, i) => (
        <li
          key={i}
          className={`${card} st-rise flex gap-3 p-4`}
          style={stagger(i, 60, 120)}
        >
          <span className="apple-display font-mono text-2xl font-semibold text-[var(--accent)] opacity-80">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 text-xs leading-relaxed text-[var(--text-secondary)]">
            <RichText text={f} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ 3. Equations */

export function VariablesTable({ vars }: { vars: EquationVar[] }) {
  return (
    // overflow-x-auto (not hidden): a wide symbol scrolls instead of being cut off.
    <div className="overflow-x-auto rounded-2xl border border-[var(--border-subtle)]">
      <table className="w-full text-left text-xs">
        <thead className="bg-[var(--bg-surface-muted)]">
          <tr>
            <th scope="col" className="w-28 px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">Symbol</th>
            <th scope="col" className="px-3 py-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {vars.map((v, i) => (
            <tr key={i} className="border-t border-[var(--border-subtle)]">
              <td className="px-3 py-1.5 text-sm text-[var(--text-primary)]">
                <Tex latex={v.symbol_latex} />
              </td>
              <td className="px-3 py-1.5 leading-relaxed text-[var(--text-secondary)]">
                <RichText text={v.meaning} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EquationsBody({ equations, derived }: { equations: EquationDoc[]; derived: boolean }) {
  return (
    <div className="space-y-4">
      {derived && (
        <div className="text-[11px] text-[var(--text-muted)]">
          No equation breakdown was extracted for this paper, so this shows the governing equation used by the simulation.
        </div>
      )}
      {equations.map((e, i) => {
        const where = locLabel(e.source);
        return (
          <article
            key={e.id || i}
            id={eqAnchor(e.id, i)}
            className={`${card} st-rise scroll-mt-28 p-5 lg:scroll-mt-6`}
            style={stagger(i, 80, 100)}
          >
            <header className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent)]">
                Eq. {i + 1}
              </span>
              <h3 className="apple-heading min-w-0 break-words text-sm font-semibold text-[var(--text-primary)]">
                <RichText text={e.title || `Equation ${i + 1}`} />
              </h3>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <SourceBadge label={where} />
                <CopyButton text={e.latex} label="LaTeX" title="Copy LaTeX source" />
              </span>
            </header>
            <div className={`${mathWell} mt-4 px-4 py-4 text-lg text-[var(--text-primary)]`}>
              <Tex latex={e.latex} display />
            </div>
            {e.explanation && (
              <div className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                <RichText text={e.explanation} />
              </div>
            )}
            {e.variables && e.variables.length > 0 && (
              <div className="mt-3">
                <div className="apple-label mb-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">Where</div>
                <VariablesTable vars={e.variables} />
              </div>
            )}
            {e.source?.quote && <QuoteBlock quote={e.source.quote} where={where} />}
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ 4. Derivation */

export function DerivationBody({ steps }: { steps: DerivationStep[] }) {
  return (
    <ol className="relative space-y-3">
      <span aria-hidden className="absolute bottom-4 left-[17px] top-4 w-px bg-[var(--border-strong)]" />
      {steps.map((s, i) => (
        <li key={i} className="st-rise relative flex gap-4" style={stagger(i, 90, 120)}>
          {/* Solid fill: the timeline rule runs behind this dot. */}
          <span className="relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent-border)] bg-[var(--bg-surface-solid)] font-mono text-xs font-semibold text-[var(--accent)]">
            {i + 1}
          </span>
          <div className={`${card} min-w-0 flex-1 p-4`}>
            <h3 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
              <RichText text={s.title} />
            </h3>
            {s.latex && (
              <div className={`${mathWell} mt-2 px-3 py-2 text-[var(--text-primary)]`}>
                <Tex latex={s.latex} display />
              </div>
            )}
            {s.explanation && (
              <div className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                <RichText text={s.explanation} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ 5. Parameters */

function RangeBar({ min, max, def, cur }: { min: number; max: number; def: number; cur: number }) {
  const span = max - min || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(1, (v - min) / span)) * 100}%`;
  return (
    <div className="relative h-2 w-full min-w-[6rem] rounded-full bg-[var(--bg-surface-muted)]" aria-hidden>
      <span className="st-grow-x absolute inset-y-0 left-0 rounded-full bg-[var(--accent-soft)]" style={{ width: pct(cur) }} />
      <span className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--text-muted)]" style={{ left: pct(def) }} title="default" />
      <span
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-surface-solid)] bg-[var(--accent)] shadow"
        style={{ left: pct(cur) }}
      />
    </div>
  );
}

export function ParametersBody({ rows, paramValues }: { rows: ParamRow[]; paramValues: Record<string, number> }) {
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead className="bg-[var(--bg-surface-muted)]">
            <tr className="text-[10px] uppercase text-[var(--text-muted)]">
              <th scope="col" className="px-3 py-2 font-semibold">Symbol</th>
              <th scope="col" className="px-3 py-2 font-semibold">Parameter</th>
              <th scope="col" className="px-3 py-2 font-semibold">Range</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Default</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Current</th>
              <th scope="col" className="px-3 py-2 font-semibold">In the paper</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, doc }, i) => {
              const cur = paramValues[p.key] ?? p.default_val;
              const delta = cur - p.default_val;
              const changed = Math.abs(delta) > (p.step || 1e-9) / 2;
              const unit = p.unit ? ` ${p.unit}` : "";
              const where = locLabel(doc?.source);
              return (
                <tr
                  key={p.key}
                  id={paramAnchor(p.key)}
                  className="st-rise scroll-mt-28 border-t border-[var(--border-subtle)] align-top lg:scroll-mt-6"
                  style={stagger(i, 50, 100)}
                >
                  <td className="px-3 py-3 text-base text-[var(--text-primary)]">
                    {doc?.symbol_latex ? <Tex latex={doc.symbol_latex} /> : <span className="font-mono text-xs">{p.key}</span>}
                  </td>
                  <td className="max-w-[22rem] px-3 py-3">
                    <div className="font-semibold text-[var(--text-primary)]">
                      {p.name} <span className="font-mono text-[10px] font-normal text-[var(--text-muted)]">{p.key}</span>
                    </div>
                    {doc?.meaning && (
                      <div className="mt-0.5 leading-relaxed text-[var(--text-secondary)]">
                        <RichText text={doc.meaning} />
                      </div>
                    )}
                    {doc?.effect && (
                      <div className="mt-1 flex gap-1 leading-relaxed text-[var(--text-secondary)]">
                        <ArrowUp className="mt-0.5 h-3 w-3 shrink-0 text-[var(--accent)]" aria-label="Increasing it" />
                        <span>
                          <RichText text={doc.effect} />
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="w-40 px-3 py-3">
                    <RangeBar min={p.min_val} max={p.max_val} def={p.default_val} cur={cur} />
                    <div className="mt-1.5 flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
                      <span>{fmtNum(p.min_val, 4)}</span>
                      <span>step {fmtNum(p.step, 3)}</span>
                      <span>{fmtNum(p.max_val, 4)}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-[var(--text-secondary)]">
                    {fmtNum(p.default_val, 4)}
                    {unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                    <span className={changed ? "font-semibold text-[var(--accent)]" : "text-[var(--text-primary)]"}>
                      {fmtNum(cur, 4)}
                      {unit}
                    </span>
                    {changed && (
                      <span className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-[var(--text-muted)]">
                        {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        {fmtNum(Math.abs(delta), 3)} vs default
                      </span>
                    )}
                  </td>
                  <td className="max-w-[12rem] px-3 py-3">
                    {doc?.typical ? (
                      <div className="leading-relaxed text-[var(--text-secondary)]">
                        <RichText text={doc.typical} />
                      </div>
                    ) : (
                      <div className="text-[var(--text-muted)]">—</div>
                    )}
                    {where && (
                      <div className="mt-1">
                        <SourceBadge label={where} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-0.5 rounded bg-[var(--text-muted)]" /> default
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" /> current slider value
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowUp className="h-3 w-3 text-[var(--accent)]" /> what increasing it does
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 6. Assumptions & limitations */

export function CaveatsBody({ assumptions, limitations }: { assumptions: string[]; limitations: string[] }) {
  const cols = [
    {
      key: "a",
      title: "Assumptions & simplifications",
      blurb: "What the model takes for granted to stay tractable.",
      items: assumptions,
      icon: ShieldAlert,
      tone: "text-[var(--status-warning)]",
      soft: "bg-[var(--status-warning-soft)] border-[var(--status-warning-border)]",
    },
    {
      key: "l",
      title: "Limitations",
      blurb: "Where the model's predictions should not be trusted.",
      items: limitations,
      icon: TriangleAlert,
      tone: "text-[var(--status-contradict)]",
      soft: "bg-[var(--status-contradict-soft)] border-[var(--status-contradict-border)]",
    },
  ].filter((c) => c.items.length > 0);
  return (
    <div className={`grid gap-4 ${cols.length > 1 ? "md:grid-cols-2" : ""}`}>
      {cols.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.key} className={`${card} p-4`}>
            <div className="flex items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${c.soft} ${c.tone}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{c.title}</h3>
                <div className="text-[10px] text-[var(--text-muted)]">{c.blurb}</div>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {c.items.map((a, i) => (
                <li key={i} className="st-rise flex gap-2 text-xs leading-relaxed text-[var(--text-secondary)]" style={stagger(i, 50, 120)}>
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${c.tone}`} aria-hidden />
                  <span>
                    <RichText text={a} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ 7. Glossary */

export function GlossaryBody({ items, derived }: { items: EquationVar[]; derived: boolean }) {
  return (
    <div>
      {derived && (
        <div className="mb-2 text-[11px] text-[var(--text-muted)]">Collected from the equation variables and parameters above.</div>
      )}
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((g, i) => (
          <div
            key={i}
            className="apple-card st-rise flex min-w-0 items-start gap-3 rounded-2xl border p-3"
            style={stagger(i, 30, 100)}
          >
            <dt className="flex min-w-[3rem] max-w-[45%] shrink-0 items-center overflow-x-auto [justify-content:safe_center] rounded-xl bg-[var(--bg-surface-muted)] px-2 py-1.5 text-base text-[var(--text-primary)]">
              <Tex latex={g.symbol_latex} />
            </dt>
            <dd className="min-w-0 text-xs leading-relaxed text-[var(--text-secondary)]">
              <RichText text={g.meaning} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ 9. Sources */

export function SourcesBody({ groups }: { groups: SourceGroup[] }) {
  return (
    <div className={`${card} divide-y divide-[var(--border-subtle)]`}>
      {groups.map((g, gi) => (
        <div key={g.page ?? "none"} className="st-rise grid gap-3 p-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]" style={stagger(gi, 60, 100)}>
          <div className="flex items-start gap-1.5">
            <BookOpen className="mt-0.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
              {g.page == null ? "No page" : `p. ${g.page}`}
            </span>
          </div>
          <ul className="space-y-2">
            {g.items.map((it, i) => {
              const content = (
                <>
                  <span className="rounded-full bg-[var(--bg-surface-muted)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {it.kind}
                  </span>
                  <span className="font-medium text-[var(--text-primary)]">{it.label}</span>
                  {it.latex && it.kind !== "Equation" && (
                    <span className="text-[var(--text-secondary)]">
                      <Tex latex={it.latex} />
                    </span>
                  )}
                  {it.section && <span className="text-[10px] text-[var(--text-muted)]">{locLabel({ section: it.section })}</span>}
                </>
              );
              return (
                <li key={i} className="text-xs">
                  {it.anchor ? (
                    <button
                      type="button"
                      onClick={() => scrollToSection(it.anchor!)}
                      className="apple-focus flex flex-wrap items-center gap-2 rounded-md text-left hover:underline"
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">{content}</div>
                  )}
                  {it.quote && (
                    <div className="mt-1 border-l-2 border-[var(--border-strong)] pl-2 italic leading-relaxed text-[var(--text-muted)]">
                      “<RichText text={it.quote} />”
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
