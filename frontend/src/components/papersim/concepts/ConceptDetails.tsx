"use client";

import React from "react";
import { ArrowRight, BookOpen, CornerDownRight, Lightbulb, MapPin, Quote, Route, Sparkles } from "lucide-react";
import type { SimulationPayload } from "../../../types/scholartwin";
import { RichText, Tex } from "../../math/MathTex";
import { KIND_META, LINK_META, mix } from "./kinds";
import { formatParamValue, paramSymbol, sourceOf, type CLink, type CNode, type ConceptGraph } from "./model";

interface ConceptDetailsProps {
  graph: ConceptGraph;
  node: CNode;
  simulation: SimulationPayload;
  paramValues: Record<string, number>;
  path: string[];
  tracing: boolean;
  onToggleTrace: () => void;
  onSelect: (id: string) => void;
}

function Section({
  title,
  icon: Icon,
  delay,
  children,
  tone = "var(--text-muted)",
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  delay: number;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <section className="st-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: tone }}>
        <Icon className="h-3 w-3" style={{ color: tone }} />
        {title}
      </h4>
      {children}
    </section>
  );
}

function NodeChip({ node, onClick, current }: { node: CNode; onClick?: () => void; current?: boolean }) {
  const m = KIND_META[node.kind];
  const Icon = m.icon;
  const body = (
    <>
      <Icon className="h-3 w-3 shrink-0" style={{ color: m.color }} />
      <RichText className="min-w-0 truncate" text={node.label} />
    </>
  );
  const cls =
    "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-xs font-medium text-[var(--text-primary)]";
  const style = { borderColor: mix(m.color, current ? 20 : 40), background: mix(m.color, current ? 6 : 12) };
  if (!onClick || current) {
    return (
      <span className={cls} style={style}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} apple-press apple-focus hover:shadow-[var(--shadow-card)]`}
      style={style}
      title={`Go to ${node.label}`}
    >
      {body}
    </button>
  );
}

function LinkSentence({
  link,
  graph,
  currentId,
  onSelect,
}: {
  link: CLink;
  graph: ConceptGraph;
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const s = graph.nodes.find((n) => n.id === link.source);
  const t = graph.nodes.find((n) => n.id === link.target);
  if (!s || !t) return null;
  const meta = LINK_META[link.kind];
  const other = s.id === currentId ? t : s;
  return (
    <li className="apple-card group relative overflow-hidden rounded-2xl border py-2.5 pl-4 pr-3">

      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: meta.color }} />
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-snug text-[var(--text-secondary)]">
        <NodeChip node={s} current={s.id === currentId} onClick={() => onSelect(s.id)} />
        <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
        <RichText className="font-medium italic" text={link.relation} />
        <ArrowRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
        <NodeChip node={t} current={t.id === currentId} onClick={() => onSelect(t.id)} />
      </p>
      {link.explanation && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          <RichText text={link.explanation} />
        </p>
      )}
      <button
        type="button"
        onClick={() => onSelect(other.id)}
        className="apple-focus mt-1 rounded-full text-[11px] font-medium text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
      >
        Explore {other.id === graph.rootId ? "the paper" : "it"} →
      </button>
    </li>
  );
}

export function ConceptDetails({
  graph,
  node,
  simulation,
  paramValues,
  path,
  tracing,
  onToggleTrace,
  onSelect,
}: ConceptDetailsProps) {
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const color = meta.color;
  const src = sourceOf(node);
  const symbol = paramSymbol(node);
  const p = node.param;
  const pd = node.paramDoc;
  const value = p ? (paramValues[p.key] ?? p.default_val) : undefined;
  const formula =
    node.kind === "parameter"
      ? undefined
      : node.latex || (node.kind === "model" ? simulation.equation_latex || undefined : undefined);
  const incoming = graph.links.filter((l) => l.target === node.id);
  const outgoing = graph.links.filter((l) => l.source === node.id);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const docs = simulation.docs;
  const findings = node.isRoot ? (docs?.key_findings ?? []).filter(Boolean) : [];
  const summary = node.summary || (node.isRoot ? docs?.overview || simulation.summary : "");

  return (
    <div key={node.id} className="min-w-0 space-y-5 p-4 sm:p-5">
      {/* Header */}
      <header className="st-fade-up space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase"
            // Text pulled 20% toward the primary text colour so the small caps clear 4.5:1 in every theme.
            style={{
              color: `color-mix(in srgb, ${color} 80%, var(--text-primary))`,
              borderColor: mix(color, 40),
              background: mix(color, 8),
              letterSpacing: "0.06em",
            }}
          >
            <Icon className="h-3 w-3" />
            {node.isRoot ? "The paper" : meta.label}
          </span>
          {src?.page != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-[var(--text-secondary)]">
              <MapPin className="h-3 w-3" />
              p.{src.page}
            </span>
          )}
        </div>
        <h3 className="break-words text-[23px] font-normal leading-tight tracking-[-0.025em] text-[var(--text-primary)]">
          <RichText text={node.label} />
        </h3>
        {/* where am I: breadcrumb from the paper */}
        {path.length > 1 && (
          <nav aria-label="Path from the paper" className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--text-muted)]">
            {path.map((id, i) => {
              const n = byId.get(id);
              if (!n) return null;
              const last = i === path.length - 1;
              return (
                <React.Fragment key={id}>
                  {i > 0 && <span aria-hidden>›</span>}
                  {last ? (
                    <span className="max-w-[140px] truncate font-semibold text-[var(--text-secondary)]" title={n.label}>
                      <RichText text={n.label} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      title={n.label}
                      className="apple-focus max-w-[140px] truncate rounded-full hover:text-[var(--text-primary)] hover:underline"
                    >
                      {n.isRoot ? "Paper" : <RichText text={n.label} />}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        )}
      </header>

      {/* Plain-language summary */}
      {summary && (
        <Section title="In plain words" icon={BookOpen} delay={50}>
          <p className="text-[13px] leading-relaxed text-[var(--text-primary)]">
            <RichText text={summary} />
          </p>
        </Section>
      )}

      {/* Parameter controls */}
      {p && value != null && (
        <section
          className="st-fade-up overflow-hidden rounded-2xl border"
          style={{
            animationDelay: "100ms",
            borderColor: mix(color, 35),
            background: `linear-gradient(160deg, ${mix(color, 12)}, transparent 70%), var(--bg-surface)`,
            boxShadow: "inset 0 1px 0 var(--glass-highlight), var(--shadow-card)",
          }}
        >
          <div className="flex items-center gap-3 px-4 pt-3.5">
            {symbol && (
              <span className="text-[20px] text-[var(--text-primary)]">
                <Tex latex={symbol} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                Current value
              </p>
              <p className="font-mono text-[17px] font-medium tabular-nums text-[var(--text-primary)]">
                {formatParamValue(value, p.unit)}
              </p>
            </div>
          </div>
          {/* Read-only: this view can't show the plot, so values are changed on the Simulate tab. */}
          <div className="px-4 pb-3.5 pt-2">
            <dl className="grid grid-cols-3 gap-2 text-center font-mono text-[10.5px]">
              {[
                ["min", p.min_val],
                ["default", p.default_val],
                ["max", p.max_val],
              ].map(([label, v]) => (
                <div key={label as string} className="min-w-0 rounded-xl bg-[var(--bg-surface-muted)] px-2 py-1.5">
                  <dt className="text-[10px] uppercase text-[var(--text-muted)]">{label}</dt>
                  <dd className="break-words font-medium text-[var(--text-primary)]">{formatParamValue(v as number, p.unit)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              Change it on the Simulate tab to see its effect on the plot.
            </p>
          </div>
          {(pd?.meaning || pd?.effect || pd?.typical) && (
            <dl className="space-y-2.5 border-t px-4 py-3 text-[12px] leading-relaxed" style={{ borderColor: mix(color, 25) }}>
              {pd?.meaning && pd.meaning !== summary && (
                <div>
                  <dt className="font-semibold text-[var(--text-primary)]">What it means</dt>
                  <dd className="text-[var(--text-secondary)]">
                    <RichText text={pd.meaning} />
                  </dd>
                </div>
              )}
              {pd?.effect && (
                <div>
                  <dt className="font-semibold text-[var(--text-primary)]">What happens when you change it</dt>
                  <dd className="text-[var(--text-secondary)]">
                    <RichText text={pd.effect} />
                  </dd>
                </div>
              )}
              {pd?.typical && (
                <div>
                  <dt className="font-semibold text-[var(--text-primary)]">Typical value</dt>
                  <dd className="text-[var(--text-secondary)]">
                    <RichText text={pd.typical} />
                  </dd>
                </div>
              )}
            </dl>
          )}
        </section>
      )}

      {/* Why it matters */}
      {node.detail && node.detail !== pd?.effect && (
        <Section title="Why it matters" icon={Lightbulb} delay={150} tone={color}>
          <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            <RichText text={node.detail} />
          </p>
        </Section>
      )}

      {findings.length > 0 && (
        <Section title="Key findings" icon={Sparkles} delay={200} tone="var(--status-support)">
          <ul className="space-y-1.5">
            {findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-support)]"
                />
                <RichText text={f} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Formula */}
      {formula && (
        <Section title="The maths" icon={Sparkles} delay={250}>
          {/* Display maths scrolls horizontally inside this well rather than being clipped. */}
          <div className="min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2 text-[var(--text-primary)]">
            <Tex latex={formula} display />
          </div>
        </Section>
      )}

      {/* Found in the paper */}
      <Section title="Found in the paper" icon={MapPin} delay={300}>
        {src ? (
          <div className="apple-card rounded-2xl border p-3">
            <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-primary)]">
              {src.section && (
                <span className="rounded-full bg-[var(--bg-surface-muted)] px-2 py-0.5">§ {src.section}</span>
              )}
              {src.page != null && (
                <span className="rounded-full bg-[var(--bg-surface-muted)] px-2 py-0.5 font-mono">page {src.page}</span>
              )}
            </p>
            {src.quote && (
              <blockquote
                className="relative mt-2.5 border-l-2 py-0.5 pl-3 text-[12.5px] italic leading-relaxed text-[var(--text-secondary)]"
                style={{ borderColor: color }}
              >
                <Quote className="absolute -left-1 -top-2 h-3 w-3 rotate-180 text-[var(--text-muted)] opacity-60" />
                <RichText text={src.quote} />
              </blockquote>
            )}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[var(--border-strong)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            {node.isRoot
              ? "This is the source paper itself; every other node points back to a part of it."
              : node.kind === "parameter"
                ? "Taken from the simulation's parameter table; no exact passage was recorded."
                : "No exact passage was recorded for this item — it was inferred from the extracted model."}
          </p>
        )}
      </Section>

      {/* How it connects to the paper */}
      {path.length > 2 && (
        <Section title="How it connects to the paper" icon={Route} delay={350}>
          <ol className="space-y-1.5">
            {path.slice(1).map((id, i) => {
              const from = byId.get(path[i]);
              const to = byId.get(id);
              const l = graph.links.find(
                (x) => (x.source === path[i] && x.target === id) || (x.target === path[i] && x.source === id)
              );
              if (!from || !to || !l) return null;
              const forward = l.source === from.id;
              return (
                <li key={id} className="flex gap-2 text-[12px] leading-snug text-[var(--text-secondary)]">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface-muted)] font-mono text-[10px] font-medium text-[var(--text-secondary)]">
                    {i + 1}
                  </span>
                  <span>
                    <b className="font-semibold text-[var(--text-primary)]">
                      <RichText text={forward ? from.label : to.label} />
                    </b>{" "}
                    <i>
                      <RichText text={l.relation} />
                    </i>{" "}
                    <b className="font-semibold text-[var(--text-primary)]">
                      <RichText text={forward ? to.label : from.label} />
                    </b>
                  </span>
                </li>
              );
            })}
          </ol>
          {/* The view's one tinted primary action; pressed = raised segment look. */}
          <button
            type="button"
            onClick={onToggleTrace}
            aria-pressed={tracing}
            className={`apple-press apple-focus relative mt-3 inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-full px-3.5 py-1.5 text-left text-xs font-semibold ${
              tracing
                ? "apple-seg-on border border-[var(--status-support-border)] text-[var(--status-support)]"
                : "apple-tint st-sheen"
            }`}
            style={{ "--tint": "var(--status-support)" } as React.CSSProperties}
          >
            <Route className="h-3.5 w-3.5 shrink-0" />
            {tracing ? "Showing path on the map" : "Trace this path on the map"}
          </button>
        </Section>
      )}

      {/* Connections */}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <Section title={`Connections (${incoming.length + outgoing.length})`} icon={CornerDownRight} delay={400}>
          <div className="space-y-3">
            {incoming.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Comes from</p>
                <ul className="space-y-1.5">
                  {incoming.map((l) => (
                    <LinkSentence key={l.id} link={l} graph={graph} currentId={node.id} onSelect={onSelect} />
                  ))}
                </ul>
              </div>
            )}
            {outgoing.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Leads to</p>
                <ul className="space-y-1.5">
                  {outgoing.map((l) => (
                    <LinkSentence key={l.id} link={l} graph={graph} currentId={node.id} onSelect={onSelect} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
