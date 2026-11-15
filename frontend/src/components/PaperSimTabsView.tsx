"use client";

import React, { useMemo, useRef, useState } from "react";
import { Activity, Code2, GitBranch, LineChart, MessageSquarePlus } from "lucide-react";
import { UIAnnotation, WorkspaceDataset } from "../types/scholartwin";
import { AppHeader, HeaderAction } from "./AppHeader";
import { SimulationTab } from "./papersim/SimulationTab";
import { ConceptGraphTab } from "./papersim/ConceptGraphTab";
import { SeriesTab } from "./papersim/SeriesTab";
import { ModelTab } from "./papersim/ModelTab";
import type { PaperSimTabProps } from "./papersim/types";
import { normalizeSimulation } from "./papersim/normalize";
import { prettyMath } from "./math/autoMath";
import { LiveTutorFab } from "../tutor/LiveTutorFab";

type PaperSimTab = "plot" | "concepts" | "series" | "code";

interface PaperSimTabsViewProps {
  dataset: WorkspaceDataset | null;
  paramValues: Record<string, number>;
  annotations: UIAnnotation[];
  statusMsg: string | null;
  onParamChange: (key: string, val: number) => void;
  onSetParams: (next: Record<string, number>) => void;
  onBackToLibrary: () => void;
  onNewConversation: () => void;
}

const TABS: {
  id: PaperSimTab;
  label: string;
  /** Phone-width label, so all four segments fit a 390px screen. */
  short: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  Component: React.ComponentType<PaperSimTabProps>;
}[] = [
  { id: "plot", label: "Interactive Simulation", short: "Simulation", icon: Activity, Component: SimulationTab },
  { id: "concepts", label: "Concept & Parameter Graph", short: "Concepts", icon: GitBranch, Component: ConceptGraphTab },
  { id: "series", label: "Series Breakdown", short: "Series", icon: LineChart, Component: SeriesTab },
  { id: "code", label: "Model & Equations", short: "Model", icon: Code2, Component: ModelTab },
];

export function PaperSimTabsView({
  dataset,
  paramValues,
  annotations,
  statusMsg,
  onParamChange,
  onSetParams,
  onBackToLibrary,
  onNewConversation,
}: PaperSimTabsViewProps) {
  const [activeTab, setActiveTab] = useState<PaperSimTab>("plot");
  // One scroller serves every tab, so a switch starts the new tab at its top.
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  const ActiveComponent = active.Component;
  // Labels -> Unicode math once, for every tab (also fixes papers saved before this change).
  const rawSim = dataset?.simulation;
  const simulation = useMemo(() => (rawSim ? normalizeSimulation(rawSim) : null), [rawSim]);
  const viewDataset = useMemo(
    () => (dataset && simulation ? { ...dataset, simulation } : null),
    [dataset, simulation]
  );

  return (
    // Transparent root: the body's colour field shows through every glass layer.
    <div className="flex h-screen flex-col text-[var(--text-primary)]">
      <AppHeader
        tone="support"
        back={{ label: "PaperSim Library", onClick: onBackToLibrary }}
        icon={Activity}
        title={dataset?.title ? prettyMath(dataset.title) : "PaperSim Workspace"}
        subtitle={dataset?.subtitle ? prettyMath(dataset.subtitle) : "Interactive paper visualisations"}
        actions={
          <HeaderAction icon={MessageSquarePlus} label="New Conversation" tone="support" onClick={onNewConversation} />
        }
      />

      {/* Visualisation tabs: a segmented glass pill (scrolls inside itself if it can't fit) */}
      <div className="mx-2 mt-2.5 flex shrink-0 justify-center sm:mx-3">
        <nav
          role="tablist"
          aria-label="PaperSim views"
          className="apple-seg flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-1 [scrollbar-width:none]"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tab.label}
                onClick={() => {
                  if (tab.id !== activeTab) scrollRef.current?.scrollTo({ top: 0 });
                  setActiveTab(tab.id);
                }}
                className={`apple-press apple-focus flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-1.5 text-xs sm:gap-1.5 sm:px-3.5 ${
                  isActive
                    ? "apple-seg-on font-semibold text-[var(--text-primary)]"
                    : "font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-[var(--status-support)]" : ""}`}
                  aria-hidden
                />
                <span className="sm:hidden">{tab.short}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {statusMsg && (
        <div className="mx-2 mt-2.5 shrink-0 rounded-2xl border border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] px-4 py-2 text-xs text-[var(--status-warning)] sm:mx-3">
          {statusMsg}
        </div>
      )}

      {/* Tab content layer. The scroller ends above a slim lane that holds the Live Tutor button
          (a sibling outside the keyed tab panel, so it keeps its call across tab switches). The
          button floats bottom-right but never over tab content, so it can't cover a control at
          rest or at any scroll position, on any tab or width. */}
      <main className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {!viewDataset || !simulation ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
              Loading simulation visualisations...
            </div>
          ) : (
            // key re-mounts the panel so each tab switch plays its entrance animation
            <div key={active.id} role="tabpanel" aria-label={active.label} className="st-fade-up h-full">
              <ActiveComponent
                dataset={viewDataset}
                simulation={simulation}
                paramValues={paramValues}
                annotations={annotations}
                onParamChange={onParamChange}
                onSetParams={onSetParams}
              />
            </div>
          )}
        </div>
        <div className="pointer-events-none flex shrink-0 justify-end px-2 pb-2 pt-1 sm:px-3 sm:pb-2.5">
          <LiveTutorFab className="pointer-events-auto relative" />
        </div>
      </main>
    </div>
  );
}
