"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import type { GraphNodeData } from "../../types/scholartwin";
import { connectionsOf, type HypothesisModel } from "./model";
import { ClaimLinks, paperUrl } from "./Bubbles";

type Tab = "paper" | "claim" | "gap";

/**
 * Side panel: plain lists of the papers, their claims and the open questions in this topic.
 * Clicking a row selects it on the graph and opens its bubble (a claim opens its paper's bubble
 * with that claim marked).
 */
export function PaperList({
  model,
  selectedId,
  onSelect,
}: {
  model: HypothesisModel;
  /** The raw selection: a paper, an open question or a claim. */
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("paper");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);

  const papers = useMemo(() => model.nodes.filter((n) => model.kind(n.id) !== "gap"), [model]);
  const gaps = useMemo(() => model.nodes.filter((n) => model.kind(n.id) === "gap"), [model]);
  const shownId = model.resolveId(selectedId);
  const claimSelected = !!selectedId && selectedId !== shownId;

  // Picking something on the canvas shows it in its tab (during render, not in an effect).
  // A claim picked here stays on the Claims tab.
  const [lastSelected, setLastSelected] = useState(selectedId);
  if (selectedId !== lastSelected) {
    setLastSelected(selectedId);
    if (shownId && !claimSelected) {
      const want: Tab = model.kind(shownId) === "gap" ? "gap" : tab === "claim" ? "claim" : "paper";
      if (want !== tab) setTab(want);
    }
  }

  const q = query.trim().toLowerCase();
  const hit = (...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));
  const paperOf = (c: GraphNodeData) => model.byId.get(model.resolveId(c.id) ?? "");
  const paperRows = papers.filter((n) => hit(n.label, n.authors_year));
  const gapRows = gaps.filter((n) => hit(n.label));
  const claimRows = model.claims.filter((c) => hit(c.label, paperOf(c)?.authors_year, paperOf(c)?.label));
  const rowCount = tab === "paper" ? paperRows.length : tab === "gap" ? gapRows.length : claimRows.length;

  // Keep the selected row in view when it's picked on the canvas.
  useEffect(() => {
    if (!selectedId) return;
    const id = tab === "claim" || !shownId ? selectedId : shownId;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, shownId, tab]);

  const tabs: { id: Tab; label: string; n: number; color: string }[] = [
    { id: "paper", label: "Papers", n: papers.length, color: "var(--accent)" },
    { id: "claim", label: "Claims", n: model.claims.length, color: "var(--text-secondary)" },
    { id: "gap", label: "Questions", n: gaps.length, color: "var(--status-gap)" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2.5 border-b border-[var(--border-subtle)] p-3">
        <div className="flex gap-1 rounded-xl bg-[var(--bg-surface-muted)] p-1" role="tablist" aria-label="Show papers or open questions">
          {tabs
            .filter((t) => t.id === "paper" || t.n > 0)
            .map((t) => {
              const dot =
                t.id === "gap"
                  ? { className: "rounded-full border border-dashed", style: { borderColor: t.color } }
                  : t.id === "claim"
                    ? { className: "rounded-full", style: { backgroundColor: t.color } }
                    : { className: "rounded-sm", style: { backgroundColor: t.color } };
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`apple-press apple-focus flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[10.5px] font-semibold transition ${
                    active
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span aria-hidden className={`h-2 w-2 shrink-0 ${dot.className}`} style={dot.style} />
                  {t.label}
                  <span className="text-[var(--text-muted)]">{t.n}</span>
                </button>
              );
            })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "paper" ? "Find a paper or author…" : tab === "claim" ? "Find a claim or paper…" : "Find an open question…"}
            aria-label={tab === "paper" ? "Find a paper" : tab === "claim" ? "Find a claim" : "Find an open question"}
            className="apple-focus w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] py-1.5 pl-8 pr-7 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--status-gap-border)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="apple-focus absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <ul ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3" role="tabpanel">
        {rowCount === 0 && (
          <li className="px-2 py-6 text-center text-xs text-[var(--text-muted)]">Nothing matches.</li>
        )}
        {tab === "paper" &&
          paperRows.map((n, i) => (
            <PaperRow key={n.id} model={model} paper={n} index={i} active={shownId === n.id} onSelect={onSelect} />
          ))}
        {tab === "gap" &&
          gapRows.map((n, i) => (
            <GapRow key={n.id} model={model} gap={n} index={i} active={shownId === n.id} onSelect={onSelect} />
          ))}
        {tab === "claim" &&
          claimRows.map((c, i) => (
            <ClaimRow
              key={c.id}
              model={model}
              claim={c}
              paper={paperOf(c)}
              index={i}
              active={selectedId === c.id}
              inSelectedPaper={!claimSelected && !!shownId && model.resolveId(c.id) === shownId}
              onSelect={onSelect}
            />
          ))}
      </ul>
    </div>
  );
}

const rowClass = (active: boolean) =>
  `st-fade-up flex items-start gap-1 rounded-xl border p-2 transition ${
    active
      ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
      : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
  }`;

function PaperRow({
  model,
  paper,
  index,
  active,
  onSelect,
}: {
  model: HypothesisModel;
  paper: GraphNodeData;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const links = connectionsOf(model, paper.id);
  const agrees = links.filter((l) => l.edge.type === "supports").length;
  const contradicts = links.filter((l) => l.edge.type === "contradicts").length;
  const questions = links.filter((l) => l.edge.type === "gap").length;
  const claims = model.claimsOf.get(paper.id)?.length ?? 0;
  const url = paperUrl(paper);

  return (
    <li
      data-node-id={paper.id}
      className={`${rowClass(active)} ${links.length === 0 && !active ? "opacity-60" : ""}`}
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <button
        type="button"
        onClick={() => onSelect(paper.id)}
        aria-current={active ? "true" : undefined}
        className="apple-focus min-w-0 flex-1 rounded-lg px-1 text-left"
      >
        {paper.authors_year && (
          <span className="block text-xs font-semibold text-[var(--text-primary)]">{paper.authors_year}</span>
        )}
        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-[var(--text-secondary)]">{paper.label}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-medium text-[var(--text-muted)]">
          {claims > 0 && <span>{claims} {claims === 1 ? "claim" : "claims"}</span>}
          {agrees > 0 && <Meta color="var(--status-support)">agrees with {agrees}</Meta>}
          {contradicts > 0 && <Meta color="var(--status-contradict)">contradicts {contradicts}</Meta>}
          {questions > 0 && (
            <Meta color="var(--status-gap)">
              {questions} open {questions === 1 ? "question" : "questions"}
            </Meta>
          )}
          {links.length === 0 && <span className="italic">Stands alone</span>}
        </span>
      </button>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${paper.authors_year || "paper"} in a new tab`}
          title="Open the paper"
          className="apple-press apple-focus shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--accent)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </li>
  );
}

function GapRow({
  model,
  gap,
  index,
  active,
  onSelect,
}: {
  model: HypothesisModel;
  gap: GraphNodeData;
  index: number;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const raisedBy = connectionsOf(model, gap.id)
    .map((l) => l.other.authors_year || l.other.label)
    .filter(Boolean);
  return (
    <li data-node-id={gap.id} className={rowClass(active)} style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}>
      <button
        type="button"
        onClick={() => onSelect(gap.id)}
        aria-current={active ? "true" : undefined}
        className="apple-focus min-w-0 flex-1 rounded-lg px-1 text-left"
      >
        <span className="line-clamp-3 block text-[11.5px] font-medium leading-snug text-[var(--text-primary)]">{gap.label}</span>
        {raisedBy.length > 0 && (
          <span className="mt-1 block text-[10px] text-[var(--text-muted)]">
            Raised by <span className="font-semibold text-[var(--text-secondary)]">{raisedBy.join(", ")}</span>
          </span>
        )}
      </button>
    </li>
  );
}

function ClaimRow({
  model,
  claim,
  paper,
  index,
  active,
  inSelectedPaper,
  onSelect,
}: {
  model: HypothesisModel;
  claim: GraphNodeData;
  paper?: GraphNodeData;
  index: number;
  active: boolean;
  inSelectedPaper: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li
      data-node-id={claim.id}
      className={rowClass(active || inSelectedPaper)}
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(claim.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(claim.id);
          }
        }}
        aria-current={active ? "true" : undefined}
        className="apple-focus min-w-0 flex-1 cursor-pointer rounded-lg px-1 text-left"
      >
        <span className="block text-[11.5px] font-medium leading-snug text-[var(--text-primary)]">{claim.label}</span>
        {paper && (
          <span className="mt-1 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]" />
            From <span className="truncate font-semibold text-[var(--text-secondary)]">{paper.authors_year || paper.label}</span>
          </span>
        )}
        <ClaimLinks model={model} claimId={claim.id} />
      </div>
    </li>
  );
}

function Meta({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1" style={{ color: `color-mix(in srgb, ${color} 80%, var(--text-primary))` }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}
