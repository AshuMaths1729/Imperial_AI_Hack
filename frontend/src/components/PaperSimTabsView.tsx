"use client";

import React, { useMemo, useRef, useState } from "react";
import { Activity, FilePlus2, GitBranch, LineChart, Sigma, TriangleAlert } from "lucide-react";
import { UIAnnotation, WorkspaceDataset } from "../types/scholartwin";
import { AppHeader, HeaderAction } from "./AppHeader";
import { Segmented } from "./glass/Segmented";
import { SimulationTab } from "./papersim/SimulationTab";
import { ConceptGraphTab } from "./papersim/ConceptGraphTab";
import { SeriesTab } from "./papersim/SeriesTab";
import { ModelTab } from "./papersim/ModelTab";
import type { PaperSimTabProps } from "./papersim/types";
import { normalizeSimulation } from "./papersim/normalize";
import { prettyMath } from "./math/autoMath";
import { MODULES } from "../modules";
import { AskTutorButton, type AskTutorTopic } from "../tutor/AskTutorButton";

type PaperSimTab = "plot" | "concepts" | "series" | "code";

interface PaperSimTabsViewProps {
  dataset: WorkspaceDataset | null;
  paramValues: Record<string, number>;
  annotations: UIAnnotation[];
  statusMsg: string | null;
  onParamChange: (key: string, val: number) => void;
  onSetParams: (next: Record<string, number>) => void;
  onBackToLibrary: () => void;
  /** Open another paper (the upload dialog). */
  onNewConversation: () => void;
}

const MODULE = MODULES.paper2sim;

/** Internal ids are unchanged (state, tests); only the words people see are short. */
const TABS: {
  id: PaperSimTab;
  label: string;
  /** What the view holds (tooltip). */
  hint: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  Component: React.ComponentType<PaperSimTabProps>;
}[] = [
  { id: "plot", label: "Simulate", hint: "Move the sliders and watch the model respond", icon: Activity, Component: SimulationTab },
  { id: "concepts", label: "Concepts", hint: "How the paper's ideas and parameters connect", icon: GitBranch, Component: ConceptGraphTab },
  { id: "series", label: "Results", hint: "What each curve does, and how they compare", icon: LineChart, Component: SeriesTab },
  { id: "code", label: "Equations", hint: "The model, its equations, assumptions and code", icon: Sigma, Component: ModelTab },
];

const tabId = (id: PaperSimTab) => `ps-tab-${id}`;
const panelId = (id: PaperSimTab) => `ps-panel-${id}`;

/** arXiv ids look like 2504.15965(v2) or hep-th/9901001; simulation ids ("sim_…") are not sources. */
const ARXIV_ID = /^(\d{4}\.\d{4,5}(v\d+)?|[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?)$/i;

/** Where the paper came from, when the dataset says (only an arXiv id survives into it). */
function sourceOf(dataset: WorkspaceDataset): AskTutorTopic["source"] {
  const id = dataset.simulation?.arxiv_id?.trim();
  if (id && ARXIV_ID.test(id)) return { kind: "url", ref: `https://arxiv.org/abs/${id}` };
  return undefined;
}

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
  const paperTitle = dataset?.title ? prettyMath(dataset.title) : undefined;
  const topic = useMemo<AskTutorTopic | null>(() => {
    if (!dataset) return null;
    const source = sourceOf(dataset);
    return { title: paperTitle ?? MODULE.name, dataset, ...(source ? { source } : {}) };
  }, [dataset, paperTitle]);

  const pick = (id: PaperSimTab) => {
    if (id !== activeTab) scrollRef.current?.scrollTo({ top: 0 });
    setActiveTab(id);
  };

  return (
    // Transparent root: the landscape shows through every glass layer.
    <div className="flex h-screen flex-col text-[var(--text-primary)]">
      {/* The paper's title appears once, here; the module name is the subtitle. */}
      <AppHeader
        tone={MODULE.tone}
        back={{ label: "All papers", onClick: onBackToLibrary }}
        icon={MODULE.icon}
        title={paperTitle ?? MODULE.name}
        subtitle={paperTitle ? MODULE.name : undefined}
        actions={<HeaderAction icon={FilePlus2} label="Open a paper" tone={MODULE.tone} onClick={onNewConversation} />}
      />

      {/* Workspace bar: the views, and the tutor (in the bar, so it never covers content). */}
      <div className="mx-2 mt-2.5 flex shrink-0 flex-wrap items-center justify-between gap-2 sm:mx-3">
        <Segmented
          kind="tabs"
          label={`${MODULE.name} views`}
          value={activeTab}
          onChange={pick}
          // Thick glass (not the thin default) so the tab names stay legible over the landscape.
          className="apple-glass glass-lens max-w-full !border-[var(--glass-rim)] !bg-[var(--bg-surface)]"
          buttonClassName="sm:px-3.5"
          options={TABS.map((t) => {
            const Icon = t.icon;
            return {
              value: t.id,
              title: t.hint,
              label: (
                <>
                  <Icon
                    className={`hidden h-3.5 w-3.5 shrink-0 sm:block ${t.id === activeTab ? "text-[var(--status-support)]" : ""}`}
                    aria-hidden
                  />
                  {t.label}
                </>
              ),
            };
          })}
          optionProps={(id) => ({
            id: tabId(id),
            // Only the shown panel exists, so only its tab points at it.
            ...(id === activeTab ? { "aria-controls": panelId(id) } : {}),
          })}
        />
        {topic && <AskTutorButton topic={topic} className="ml-auto" />}
      </div>

      {statusMsg && (
        <div
          role="status"
          className="apple-sheet mx-2 mt-2.5 flex shrink-0 items-start gap-2 rounded-2xl px-4 py-2.5 text-xs text-[var(--text-primary)] sm:mx-3"
        >
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden />
          {statusMsg}
        </div>
      )}

      {/* Tab content: one scroller for every tab. */}
      <main className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto pt-2.5">
          {!viewDataset || !simulation ? (
            <div className="flex h-full items-center justify-center px-4">
              <p className="apple-sheet rounded-full px-4 py-2 text-xs text-[var(--text-secondary)]">
                Loading the simulation…
              </p>
            </div>
          ) : (
            // key re-mounts the panel so each tab switch plays its entrance animation. Fill mode
            // `backwards`, not `both`: an animation still filling makes the panel a backdrop root in
            // Chromium, and every glass popover inside it would lose its blur.
            <div
              key={active.id}
              id={panelId(active.id)}
              role="tabpanel"
              aria-labelledby={tabId(active.id)}
              className="st-fade-up h-full ![animation-fill-mode:backwards]"
            >
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
      </main>
    </div>
  );
}
