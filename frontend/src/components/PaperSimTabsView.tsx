"use client";

import React, { useMemo, useState } from "react";
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
  icon: React.ComponentType<{ className?: string }>;
  Component: React.ComponentType<PaperSimTabProps>;
}[] = [
  { id: "plot", label: "Interactive Simulation", icon: Activity, Component: SimulationTab },
  { id: "concepts", label: "Concept & Parameter Graph", icon: GitBranch, Component: ConceptGraphTab },
  { id: "series", label: "Series Breakdown", icon: LineChart, Component: SeriesTab },
  { id: "code", label: "Model & Equations", icon: Code2, Component: ModelTab },
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
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
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

      {/* Visualisation Tabs */}
      <nav
        role="tablist"
        aria-label="PaperSim views"
        className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2"
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
              onClick={() => setActiveTab(tab.id)}
              className={`apple-press apple-focus flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                isActive
                  ? "bg-[var(--status-support)] font-semibold text-[var(--accent-fg)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {statusMsg && (
        <div className="m-4 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] px-4 py-2 text-xs text-[var(--status-warning)]">
          {statusMsg}
        </div>
      )}

      <main className="relative min-h-0 flex-1 overflow-auto">
        {!viewDataset || !simulation ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
            Loading simulation visualisations...
          </div>
        ) : (
          // key re-mounts the panel so each tab switch plays its entrance animation
          <div key={active.id} role="tabpanel" className="st-fade-up h-full">
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
      </main>
    </div>
  );
}
