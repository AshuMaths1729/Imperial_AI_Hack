"use client";

import React, { useState } from "react";
import { BookOpen, CheckCircle2, AlertTriangle, Code2, Sparkles } from "lucide-react";
import { GraphEdgeData, GraphNodeData, SimulationPayload, WorkspaceMode } from "../types/scholartwin";

interface InspectorPaneProps {
  mode: WorkspaceMode;
  selectedNode: GraphNodeData | null;
  edges: GraphEdgeData[];
  simulation?: SimulationPayload | null;
}

export function InspectorPane({ mode, selectedNode, edges, simulation }: InspectorPaneProps) {
  // Track which node the pick belongs to so it resets when the node changes (no effect needed).
  const [pick, setPick] = useState<{ nodeId: string | undefined; option: number } | null>(null);
  const selectedOption = pick && pick.nodeId === selectedNode?.id ? pick.option : null;
  const setSelectedOption = (option: number) => setPick({ nodeId: selectedNode?.id, option });

  const relatedEdges = selectedNode
    ? edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
    : [];

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Context Inspector
        </span>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-sky-300">
          {mode === "lecture" ? "Understand" : mode === "paper2sim" ? "Reproduce" : "Verify"}
        </span>
      </div>

      {/* Paper2Sim Inspector */}
      {mode === "paper2sim" && simulation && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
              <Sparkles className="h-3.5 w-3.5" />
              {simulation.arxiv_id}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">{simulation.summary}</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Code2 className="h-3.5 w-3.5 text-emerald-400" />
              Generated Sandboxed Python
            </div>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-2.5 text-[11px] leading-relaxed text-emerald-300">
              <code>{simulation.python_code}</code>
            </pre>
          </div>
        </div>
      )}

      {/* Graph Node Inspector (Lecture & Hypothesis) */}
      {mode !== "paper2sim" && selectedNode && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">{selectedNode.label}</h3>
              {selectedNode.slide_ref && (
                <span className="shrink-0 rounded bg-sky-950 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                  {selectedNode.slide_ref}
                </span>
              )}
            </div>
            {selectedNode.authors_year && (
              <p className="mt-1 text-[11px] font-medium text-purple-300">{selectedNode.authors_year}</p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-300">{selectedNode.summary}</p>

            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                <span>Mastery / Confidence</span>
                <span>{selectedNode.mastery}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-sky-400 transition-all"
                  style={{ width: `${selectedNode.mastery}%` }}
                />
              </div>
            </div>
          </div>

          {/* Adaptive Quiz for LectureGraph */}
          {selectedNode.quiz.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <BookOpen className="h-3.5 w-3.5" />
                Adaptive Concept Check
              </div>
              <p className="text-xs font-medium text-slate-100">{selectedNode.quiz[0].question}</p>
              <div className="mt-3 space-y-1.5">
                {selectedNode.quiz[0].options.map((opt, idx) => {
                  const isCorrect = idx === selectedNode.quiz[0].correct_index;
                  const isPicked = selectedOption === idx;
                  let btnStyle = "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600";
                  if (selectedOption !== null) {
                    if (isCorrect) btnStyle = "border-emerald-500 bg-emerald-950/60 text-emerald-200";
                    else if (isPicked) btnStyle = "border-rose-500 bg-rose-950/60 text-rose-200";
                  }
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedOption(idx)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${btnStyle}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {selectedOption !== null && (
                <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-300">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  {selectedNode.quiz[0].explanation}
                </p>
              )}
            </div>
          )}

          {/* Evidence & Contradiction Cards */}
          {relatedEdges.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">Linked Claims & Conditions</p>
              {relatedEdges.map((edge) => (
                <div
                  key={edge.id}
                  className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs"
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    {edge.type === "contradicts" && <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />}
                    <span
                      className={
                        edge.type === "contradicts"
                          ? "text-rose-400"
                          : edge.type === "supports"
                          ? "text-emerald-400"
                          : edge.type === "gap"
                          ? "text-purple-400"
                          : "text-sky-400"
                      }
                    >
                      {edge.type.toUpperCase()}: {edge.label}
                    </span>
                  </div>
                  {edge.condition && (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{edge.condition}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode !== "paper2sim" && !selectedNode && (
        <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
          Click any node or circle a region on the canvas to inspect concepts, quizzes, or evidence.
        </div>
      )}
    </aside>
  );
}
