"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Code2,
  ExternalLink,
  HelpCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import { GraphEdgeData, GraphNodeData, SimulationPayload, WorkspaceMode } from "../types/scholartwin";
import { resolveCitationUrl } from "../api/citations";

interface InspectorPaneProps {
  mode: WorkspaceMode;
  selectedNode: GraphNodeData | null;
  edges: GraphEdgeData[];
  simulation?: SimulationPayload | null;
}

const EDGE_STYLE: Record<
  GraphEdgeData["type"],
  { colorVar: string; icon: React.ComponentType<{ className?: string }> }
> = {
  supports: { colorVar: "var(--status-support)", icon: CheckCircle2 },
  contradicts: { colorVar: "var(--status-contradict)", icon: AlertTriangle },
  gap: { colorVar: "var(--status-gap)", icon: HelpCircle },
  prerequisite: { colorVar: "var(--accent)", icon: ArrowRight },
};

export function InspectorPane({ mode, selectedNode, edges, simulation }: InspectorPaneProps) {
  // Track which node the pick belongs to so it resets when the node changes (no effect needed).
  const [pick, setPick] = useState<{ nodeId: string | undefined; option: number } | null>(null);
  const selectedOption = pick && pick.nodeId === selectedNode?.id ? pick.option : null;
  const setSelectedOption = (option: number) => setPick({ nodeId: selectedNode?.id, option });

  const relatedEdges = selectedNode
    ? edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
    : [];

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center justify-between">
        <span className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
          Context Inspector
        </span>
        <span className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
          {mode === "lecture" ? "Understand" : mode === "paper2sim" ? "Reproduce" : "Verify"}
        </span>
      </div>

      {/* Paper2Sim Inspector */}
      {mode === "paper2sim" && simulation && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              {simulation.arxiv_id}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              {simulation.summary}
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
              <Code2 className="h-3.5 w-3.5 text-[var(--status-support)]" />
              Generated Sandboxed Python
            </div>
            <pre className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 text-[11px] leading-relaxed text-[var(--status-support)]">
              <code>{simulation.python_code}</code>
            </pre>
          </div>
        </div>
      )}

      {/* Graph Node Inspector (Lecture & Hypothesis) */}
      {mode !== "paper2sim" && selectedNode && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
                {selectedNode.label}
              </h3>
              {selectedNode.slide_ref && (
                <span className="shrink-0 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                  {selectedNode.slide_ref}
                </span>
              )}
            </div>
            {selectedNode.authors_year && (() => {
              const url = resolveCitationUrl({
                docId: selectedNode.doc_id,
                citation: selectedNode.authors_year,
                title: selectedNode.label,
              });
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="apple-focus mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--status-gap)] hover:underline"
                >
                  <span>{selectedNode.authors_year}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <p className="mt-1 text-[11px] font-semibold text-[var(--status-gap)]">
                  {selectedNode.authors_year}
                </p>
              );
            })()}
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              {selectedNode.summary}
            </p>

            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-[var(--text-muted)]">
                <span>Mastery / Confidence</span>
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  {selectedNode.mastery}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${selectedNode.mastery}%` }}
                />
              </div>
            </div>
          </div>

          {/* Adaptive Quiz for LectureGraph */}
          {selectedNode.quiz.length > 0 && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--status-warning)]">
                <BookOpen className="h-3.5 w-3.5" />
                Adaptive Concept Check
              </div>
              <p className="text-xs font-medium text-[var(--text-primary)]">
                {selectedNode.quiz[0].question}
              </p>
              <div className="mt-3 space-y-1.5">
                {selectedNode.quiz[0].options.map((opt, idx) => {
                  const isCorrect = idx === selectedNode.quiz[0].correct_index;
                  const isPicked = selectedOption === idx;
                  const showCorrect = selectedOption !== null && isCorrect;
                  const showWrong = selectedOption !== null && isPicked && !isCorrect;

                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedOption(idx)}
                      style={
                        showCorrect
                          ? {
                              borderColor: "var(--status-support)",
                              backgroundColor: "var(--status-support-soft)",
                              color: "var(--text-primary)",
                            }
                          : showWrong
                          ? {
                              borderColor: "var(--status-contradict)",
                              backgroundColor: "var(--status-contradict-soft)",
                              color: "var(--text-primary)",
                            }
                          : undefined
                      }
                      className={`apple-press apple-focus flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs ${
                        !showCorrect && !showWrong
                          ? "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                          : ""
                      }`}
                    >
                      <span>{opt}</span>
                      {showCorrect && (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--status-support)]" />
                      )}
                      {showWrong && (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--status-contradict)]" />
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedOption !== null && (
                <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-support)]" />
                  {selectedNode.quiz[0].explanation}
                </p>
              )}
            </div>
          )}

          {/* Evidence & Contradiction Cards */}
          {relatedEdges.length > 0 && (
            <div className="space-y-2">
              <p className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                Linked Claims & Conditions
              </p>
              {relatedEdges.map((edge) => {
                const spec = EDGE_STYLE[edge.type];
                const Icon = spec.icon;
                return (
                  <div
                    key={edge.id}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-xs"
                  >
                    <div
                      style={{ color: spec.colorVar }}
                      className="flex items-center gap-1.5 font-semibold"
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {edge.type.toUpperCase()}: {edge.label}
                      </span>
                    </div>
                    {edge.condition && (
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        {edge.condition}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {mode !== "paper2sim" && !selectedNode && (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-6 text-center text-xs text-[var(--text-muted)]">
          Click any node or circle a region on the canvas to inspect concepts, quizzes, or evidence.
        </div>
      )}
    </aside>
  );
}
