"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Code2,
  GitBranch,
  GraduationCap,
  LineChart,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react";
import {
  GraphEdgeData,
  GraphNodeData,
  UIAnnotation,
  WorkspaceDataset,
} from "../types/scholartwin";
import { PaperSimCanvas } from "./PaperSimCanvas";
import { GraphCanvas } from "./GraphCanvas";
import { ThemeToggle } from "./ThemeProvider";

type PaperSimTab = "plot" | "concepts" | "series" | "code";

interface PaperSimTabsViewProps {
  dataset: WorkspaceDataset | null;
  paramValues: Record<string, number>;
  annotations: UIAnnotation[];
  statusMsg: string | null;
  onParamChange: (key: string, val: number) => void;
  onBackToLibrary: () => void;
  onNewConversation: () => void;
}

export function PaperSimTabsView({
  dataset,
  paramValues,
  annotations,
  statusMsg,
  onParamChange,
  onBackToLibrary,
  onNewConversation,
}: PaperSimTabsViewProps) {
  const [activeTab, setActiveTab] = useState<PaperSimTab>("plot");
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);

  const conceptGraph = useMemo<{ nodes: GraphNodeData[]; edges: GraphEdgeData[] }>(() => {
    if (!dataset?.simulation) return { nodes: [], edges: [] };
    if (dataset.nodes.length > 0) {
      return { nodes: dataset.nodes, edges: dataset.edges };
    }
    const sim = dataset.simulation;
    const nodes: GraphNodeData[] = [
      {
        id: "sim-core",
        label: sim.paper_title,
        category: "core",
        summary: sim.summary || "Extracted mathematical model from uploaded paper.",
        mastery: 0,
        x: 340,
        y: 60,
        quiz: [],
      },
      ...sim.params.map((p, idx) => ({
        id: `param-${p.key}`,
        label: p.name,
        category: "prerequisite" as const,
        summary: `Parameter "${p.key}" in [${p.min_val}, ${p.max_val}] ${p.unit} (current: ${paramValues[p.key] ?? p.default_val}).`,
        mastery: 0,
        x: 80 + idx * 260,
        y: 230,
        quiz: [],
      })),
      ...sim.series.map((s, idx) => ({
        id: `series-${idx}`,
        label: s.name,
        category: "claim" as const,
        summary: `Simulated observable (${s.y.length} samples along ${sim.x_label}).`,
        mastery: 0,
        x: 160 + idx * 300,
        y: 400,
        quiz: [],
      })),
    ];

    const edges: GraphEdgeData[] = [
      ...sim.params.map((p) => ({
        id: `e-param-${p.key}`,
        source: `param-${p.key}`,
        target: "sim-core",
        type: "prerequisite" as const,
        label: "governs",
      })),
      ...sim.series.map((_, idx) => ({
        id: `e-series-${idx}`,
        source: "sim-core",
        target: `series-${idx}`,
        type: "supports" as const,
        label: "produces",
      })),
    ];

    return { nodes, edges };
  }, [dataset, paramValues]);

  const selectedConcept =
    conceptGraph.nodes.find((n) => n.id === selectedConceptId) ?? conceptGraph.nodes[0] ?? null;

  const tabs: { id: PaperSimTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "plot", label: "Interactive Simulation", icon: Activity },
    { id: "concepts", label: "Concept & Parameter Graph", icon: GitBranch },
    { id: "series", label: "Series Breakdown", icon: LineChart },
    { id: "code", label: "Model & Equations", icon: Code2 },
  ];

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="apple-glass z-30 flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToLibrary}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--status-support-border)] hover:text-[var(--status-support)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            PaperSim Library
          </button>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--status-support-soft)] text-[var(--status-support)]">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div>
              <h1 className="apple-heading text-xs font-bold text-[var(--text-primary)]">
                {dataset?.title ?? "PaperSim Workspace"}
              </h1>
              <p className="text-[11px] text-[var(--text-muted)]">
                {dataset?.subtitle ?? "Interactive Paper Visualisations"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={onNewConversation}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--status-support-border)] bg-[var(--status-support-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--status-support)] hover:opacity-90"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New Conversation
          </button>
          <a
            href="/tutor"
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <GraduationCap className="h-3.5 w-3.5 text-[var(--accent)]" />
            Live Tutor
          </a>
        </div>
      </header>

      {/* Visualisation Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`apple-press apple-focus flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
                active
                  ? "bg-[var(--status-support)] font-semibold text-[var(--accent-fg)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {statusMsg && (
        <div className="m-4 rounded-xl border border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] px-4 py-2 text-xs text-[var(--status-warning)]">
          {statusMsg}
        </div>
      )}

      <main className="relative min-h-0 flex-1 overflow-auto">
        {!dataset?.simulation ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
            Loading simulation visualisations...
          </div>
        ) : activeTab === "plot" ? (
          <PaperSimCanvas
            simulation={dataset.simulation}
            paramValues={paramValues}
            annotations={annotations}
            onParamChange={onParamChange}
          />
        ) : activeTab === "concepts" ? (
          <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_300px]">
            <div className="relative min-h-[420px]">
              <GraphCanvas
                nodes={conceptGraph.nodes}
                edges={conceptGraph.edges}
                selectedNodeId={selectedConcept?.id ?? null}
                annotations={annotations}
                onSelectNode={(n) => setSelectedConceptId(n.id)}
              />
            </div>
            <aside className="border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="apple-label text-[11px] font-semibold uppercase text-[var(--status-support)]">
                Concept Details
              </p>
              {selectedConcept ? (
                <div className="mt-3 space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selectedConcept.label}</h3>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {selectedConcept.summary}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-[var(--text-muted)]">Select a node to inspect it.</p>
              )}
            </aside>
          </div>
        ) : activeTab === "series" ? (
          <div className="mx-auto max-w-5xl space-y-4 p-6">
            <h2 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
              Output Series Summary ({dataset.simulation.x_label} vs {dataset.simulation.y_label})
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {dataset.simulation.series.map((s) => {
                const min = s.y.length ? Math.min(...s.y) : 0;
                const max = s.y.length ? Math.max(...s.y) : 0;
                const finalVal = s.y.length ? s.y[s.y.length - 1] : 0;
                return (
                  <div
                    key={s.name}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">{s.name}</h3>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-[var(--bg-surface-muted)] p-2">
                        <p className="text-[10px] text-[var(--text-muted)]">Min</p>
                        <p className="font-mono text-xs font-semibold text-[var(--text-primary)]">{min.toFixed(3)}</p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-surface-muted)] p-2">
                        <p className="text-[10px] text-[var(--text-muted)]">Max</p>
                        <p className="font-mono text-xs font-semibold text-[var(--text-primary)]">{max.toFixed(3)}</p>
                      </div>
                      <div className="rounded-xl bg-[var(--bg-surface-muted)] p-2">
                        <p className="text-[10px] text-[var(--text-muted)]">Final</p>
                        <p className="font-mono text-xs font-semibold text-[var(--text-primary)]">{finalVal.toFixed(3)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-4 p-6">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <h2 className="apple-label text-xs font-semibold uppercase text-[var(--status-support)]">
                Extracted Model Summary
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                {dataset.simulation.summary}
              </p>
              {dataset.simulation.equation_latex && (
                <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 font-mono text-xs text-[var(--accent)]">
                  {dataset.simulation.equation_latex}
                </pre>
              )}
            </div>
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <h2 className="apple-label text-xs font-semibold uppercase text-[var(--text-muted)]">
                Python Simulation Code
              </h2>
              <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 font-mono text-xs leading-relaxed text-[var(--text-primary)]">
                {dataset.simulation.python_code || "# Generated simulation code runs on the backend sandbox."}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
