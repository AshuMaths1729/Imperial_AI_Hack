"use client";

import { ConfirmDelete } from "@/components/glass/ConfirmDelete";
import React, { useState } from "react";
import { Clock, History, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { WorkspaceDataset } from "../../types/scholartwin";

export interface TopicRun {
  id: string;
  title: string;
  updatedAt: string;
  dataset: WorkspaceDataset;
  /** The node last clicked in this topic; reopening the topic zooms back to it. */
  lastNodeId?: string;
}

interface TopicSidebarProps {
  runs: TopicRun[];
  activeRunId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNewTopic: () => void;
  onOpenRun: (run: TopicRun) => void;
  onDeleteRun: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

function edgeCounts(dataset: WorkspaceDataset) {
  let supports = 0;
  let contradicts = 0;
  let gaps = 0;
  for (const e of dataset.edges) {
    if (e.type === "supports") supports++;
    else if (e.type === "contradicts") contradicts++;
    else if (e.type === "gap") gaps++;
  }
  return { supports, contradicts, gaps };
}

/** A compact but still descriptive title for the collapsed rail ("Does X improve Y?" -> "X improve Y"). */
function shortTitle(title: string): string {
  const t = title
    .trim()
    .replace(/^(does|do|is|are|can|could|how|what|why|which|should|will|would)\s+/i, "")
    .replace(/[?.]+$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : title;
}

function PeekStats({ run }: { run: TopicRun }) {
  const c = edgeCounts(run.dataset);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-[var(--text-muted)]">
      <span className="flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        {formatDate(run.updatedAt)}
      </span>
      <span>{run.dataset.nodes.length} nodes</span>
      <span className="flex items-center gap-1 text-[var(--status-support)]">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {c.supports} supports
      </span>
      <span className="flex items-center gap-1 text-[var(--status-contradict)]">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {c.contradicts} contradicts
      </span>
      <span className="flex items-center gap-1 text-[var(--status-gap)]">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {c.gaps} gaps
      </span>
    </div>
  );
}

/**
 * Saved Evidence Map topics, as a floating thick-glass sheet. Collapses to a narrow rail of mini
 * cards (short title, evidence mix, date) with a full-title peek on hover; on phones the rail is
 * icon-only and the expanded sheet overlays the page.
 *
 * The peek is position: fixed, so nothing on or above this sheet may get a transform, filter,
 * backdrop-filter or containment (that would clip it). The one blur below is phone-only and only
 * while expanded, when no peek can show.
 */
export function TopicSidebar({
  runs,
  activeRunId,
  collapsed,
  onToggleCollapsed,
  onNewTopic,
  onOpenRun,
  onDeleteRun,
}: TopicSidebarProps) {
  const [peek, setPeek] = useState<{ run: TopicRun; left: number; top: number } | null>(null);
  const showPeek = (run: TopicRun, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPeek({ run, left: r.right + 10, top: Math.max(8, Math.min(r.top, window.innerHeight - 140)) });
  };

  return (
    <aside
      id="hypothesis-topics"
      aria-label="Saved topics"
      className={`apple-sheet z-20 flex h-full shrink-0 flex-col overflow-hidden rounded-[26px] transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] max-md:absolute max-md:inset-y-0 max-md:left-0 md:relative ${
        collapsed
          ? "w-[60px] md:w-[124px]"
          : "w-64 max-md:!shadow-[inset_0_1px_0_var(--glass-highlight),var(--shadow-elevated)] max-md:backdrop-blur-[22px] max-md:backdrop-saturate-150"
      }`}
    >
      {/* Top: New topic + collapse toggle */}
      <div
        className={`flex shrink-0 gap-2 border-b border-[var(--border-subtle)] p-2.5 ${
          collapsed ? "flex-col items-center md:flex-row md:justify-center" : "items-center"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setPeek(null);
            onNewTopic();
          }}
          aria-label="New topic"
          title="New topic"
          style={{ "--tint": "var(--status-gap)" } as React.CSSProperties}
          className={`apple-tint apple-press apple-focus st-sheen group relative flex h-9 items-center justify-center gap-1.5 overflow-hidden rounded-full text-xs font-semibold transition hover:brightness-110 ${
            collapsed ? "w-9 max-md:order-2 md:flex-1" : "flex-1 px-3"
          }`}
        >
          <Plus className="h-4 w-4 transition-transform duration-300 group-hover:rotate-90" />
          {!collapsed && <span className="whitespace-nowrap">New topic</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            setPeek(null);
            onToggleCollapsed();
          }}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="hypothesis-topics"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="apple-press apple-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:border-[var(--status-gap-border)] hover:text-[var(--status-gap)]"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {collapsed ? (
        <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 py-3">
          {/* Phones: the rail is too narrow for titles, so it just counts topics and expands. */}
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={`${runs.length} saved ${runs.length === 1 ? "topic" : "topics"}: expand to browse`}
            aria-label={`Show ${runs.length} saved topics`}
            className="apple-press apple-focus relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--status-gap)] md:hidden"
          >
            <History className="h-4 w-4" />
            {runs.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-gap)] px-1 text-[9px] font-bold text-[var(--accent-fg)]">
                {runs.length}
              </span>
            )}
          </button>

          <span className="apple-label hidden w-full px-1 pb-0.5 text-[9.5px] font-semibold uppercase text-[var(--text-muted)] md:block">
            Topics · {runs.length}
          </span>
          {runs.map((run, idx) => {
            const active = run.id === activeRunId;
            const c = edgeCounts(run.dataset);
            const total = Math.max(1, c.supports + c.contradicts + c.gaps);
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => onOpenRun(run)}
                aria-label={`Open ${run.title}`}
                aria-current={active ? "true" : undefined}
                onMouseEnter={(e) => showPeek(run, e.currentTarget)}
                onMouseLeave={() => setPeek(null)}
                onFocus={(e) => showPeek(run, e.currentTarget)}
                onBlur={() => setPeek(null)}
                style={{
                  animationDelay: `${idx * 40}ms`,
                  ...(active ? { borderColor: "var(--status-gap-border)", backgroundColor: "var(--status-gap-soft)" } : {}),
                }}
                className={`apple-press apple-focus st-fade-up hidden w-full shrink-0 flex-col gap-1 rounded-[14px] border p-2 text-left shadow-[inset_0_1px_0_var(--glass-highlight)] transition-all duration-200 md:flex ${
                  active
                    ? ""
                    : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:-translate-y-px hover:border-[var(--status-gap-border)]"
                }`}
              >
                {/* Evidence mix at a glance: supports / contradicts / gaps */}
                <span aria-hidden className="flex h-1 w-full gap-px overflow-hidden rounded-full bg-[var(--border-subtle)]">
                  <span style={{ width: `${(c.supports / total) * 100}%` }} className="bg-[var(--status-support)]" />
                  <span style={{ width: `${(c.contradicts / total) * 100}%` }} className="bg-[var(--status-contradict)]" />
                  <span style={{ width: `${(c.gaps / total) * 100}%` }} className="bg-[var(--status-gap)]" />
                </span>
                <span
                  className={`line-clamp-3 break-words text-[10.5px] font-semibold leading-snug ${
                    active ? "text-[var(--status-gap)]" : "text-[var(--text-primary)]"
                  }`}
                >
                  {shortTitle(run.title)}
                </span>
                <span className="text-[9.5px] text-[var(--text-muted)]">{formatDate(run.updatedAt)}</span>
              </button>
            );
          })}

          {/* Hover/focus peek with the full title (fixed, so the rail's overflow can't clip it) */}
          {peek && (
            <div
              role="tooltip"
              style={{ left: peek.left, top: peek.top }}
              className="apple-glass-elevated apple-materialize pointer-events-none fixed z-50 hidden w-64 rounded-[20px] border p-3 md:block"
            >
              <p className="text-xs font-semibold leading-snug text-[var(--text-primary)]">{peek.run.title}</p>
              <PeekStats run={peek.run} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between px-3.5 pb-1.5 pt-3">
            <span className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
              Saved topics
            </span>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-px text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
              {runs.length}
            </span>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-3 pt-1">
            {runs.length === 0 ? (
              <div className="st-fade-up mt-2 flex flex-col items-center rounded-2xl border border-dashed border-[var(--border-strong)] px-3 py-6 text-center">
                <History className="st-bob mb-2 h-5 w-5 text-[var(--text-muted)]" />
                <p className="text-[11px] text-[var(--text-muted)]">
                  Evidence maps you make are saved here, so you can come back to them.
                </p>
              </div>
            ) : (
              runs.map((run, idx) => {
                const active = run.id === activeRunId;
                const c = edgeCounts(run.dataset);
                return (
                  <div
                    key={run.id}
                    onClick={() => onOpenRun(run)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${run.title}`}
                    aria-current={active ? "true" : undefined}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenRun(run);
                      }
                    }}
                    style={{
                      animationDelay: `${idx * 45}ms`,
                      ...(active
                        ? { borderColor: "var(--status-gap-border)", backgroundColor: "var(--status-gap-soft)" }
                        : {}),
                    }}
                    className={`apple-press apple-focus st-fade-up group relative flex cursor-pointer items-start justify-between gap-2 overflow-hidden rounded-[14px] border py-2 pl-3 pr-2 transition-all duration-200 ${
                      active
                        ? "shadow-[inset_0_1px_0_var(--glass-highlight)]"
                        : "border-transparent hover:translate-x-0.5 hover:border-[var(--border-subtle)] hover:bg-[var(--bg-surface-muted)]"
                    }`}
                  >
                    {/* Accent bar on the active topic */}
                    <span
                      aria-hidden
                      className={`absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--status-gap)] transition-opacity ${
                        active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        title={run.title}
                        className={`line-clamp-2 break-words text-xs font-medium leading-snug ${
                          active ? "text-[var(--status-gap)]" : "text-[var(--text-primary)]"
                        }`}
                      >
                        {run.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDate(run.updatedAt)}
                        </span>
                        <span>{run.dataset.nodes.length} nodes</span>
                        <span
                          className="flex items-center gap-1.5"
                          title={`${c.supports} supports · ${c.contradicts} contradicts · ${c.gaps} gaps`}
                        >
                          <span className="flex items-center gap-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-support)]" />
                            {c.supports}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-contradict)]" />
                            {c.contradicts}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-gap)]" />
                            {c.gaps}
                          </span>
                        </span>
                      </div>
                    </div>
                    <ConfirmDelete
                      label={`Delete ${run.title}`}
                      onConfirm={() => onDeleteRun(run.id)}
                      iconClassName="h-3.5 w-3.5"
                      // Hidden until hover on desktop; always shown on touch screens (no hover there).
                      className="h-7 min-w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    />
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
}
