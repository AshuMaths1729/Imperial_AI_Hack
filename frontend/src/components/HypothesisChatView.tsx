"use client";

import React, { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  BookOpen,
  Clock,
  GitCompare,
  GraduationCap,
  History,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { createTopicGraph } from "../api/endpoints";
import { graphToWorkspaceDataset } from "../api/adapters";
import { GraphEdgeData, GraphNodeData, WorkspaceDataset } from "../types/scholartwin";
import { GraphCanvas } from "./GraphCanvas";

export interface HypothesisTopicRun {
  id: string;
  title: string;
  updatedAt: string;
  dataset: WorkspaceDataset;
}

interface HypothesisChatViewProps {
  onBackHome: () => void;
}

const HISTORY_STORAGE_KEY = "scholartwin.hypothesis.history.v1";

const STARTER_QUERIES = [
  "Compute-optimal scaling laws: Chinchilla vs Kaplan",
  "Does chain-of-thought prompting improve mathematical reasoning reliability?",
  "LoRA vs full fine-tuning generalization on domain-specific tasks",
];

const EDGE_BADGE: Record<GraphEdgeData["type"], { label: string; cls: string }> = {
  supports: {
    label: "Supports",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  contradicts: {
    label: "Contradicts",
    cls: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  },
  gap: {
    label: "Research Gap",
    cls: "border-purple-500/40 bg-purple-500/15 text-purple-300",
  },
  prerequisite: {
    label: "Prerequisite",
    cls: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  },
};

type SpeechRecCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

let cachedHistoryRaw: string | null = null;
let cachedHistory: HypothesisTopicRun[] = [];
const EMPTY_HISTORY: HypothesisTopicRun[] = [];
const historyListeners = new Set<() => void>();

function subscribeHistory(cb: () => void) {
  historyListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === HISTORY_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    historyListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getHistorySnapshot(): HypothesisTopicRun[] {
  if (typeof window === "undefined") return EMPTY_HISTORY;
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return EMPTY_HISTORY;
    if (raw === cachedHistoryRaw) return cachedHistory;
    const parsed = JSON.parse(raw) as HypothesisTopicRun[];
    if (Array.isArray(parsed)) {
      cachedHistoryRaw = raw;
      cachedHistory = parsed.filter((item) => item && item.dataset);
      return cachedHistory;
    }
  } catch {
    // ignore malformed storage
  }
  return EMPTY_HISTORY;
}

function getServerHistorySnapshot(): HypothesisTopicRun[] {
  return EMPTY_HISTORY;
}

function persistHistory(next: HypothesisTopicRun[]) {
  try {
    const serialized = JSON.stringify(next);
    cachedHistoryRaw = serialized;
    cachedHistory = next;
    localStorage.setItem(HISTORY_STORAGE_KEY, serialized);
    historyListeners.forEach((cb) => cb());
  } catch {
    // ignore storage quota errors
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function HypothesisChatView({ onBackHome }: HypothesisChatViewProps) {
  const history = useSyncExternalStore(
    subscribeHistory,
    getHistorySnapshot,
    getServerHistorySnapshot
  );
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [dataset, setDataset] = useState<WorkspaceDataset | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecCtor> | null>(null);

  const startNewTopic = () => {
    setActiveRunId(null);
    setDataset(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    setErrorMsg(null);
    setQuery("");
  };

  const openRun = (run: HypothesisTopicRun) => {
    setActiveRunId(run.id);
    setQuery(run.title);
    setDataset(run.dataset);
    setSelectedNode(run.dataset.nodes[0] ?? null);
    setSelectedEdge(null);
    setErrorMsg(null);
  };

  const deleteRun = (id: string) => {
    persistHistory(history.filter((c) => c.id !== id));
    if (activeRunId === id) startNewTopic();
  };

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setErrorMsg("Browser speech recognition is unavailable here. Type your topic below.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript;
      if (transcript) setQuery((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  };

  const runTopicSearch = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || loading) return;
    setQuery(trimmed);
    setErrorMsg(null);
    setSelectedEdge(null);
    setLoading(true);
    try {
      const graph = await createTopicGraph(trimmed, 12);
      const mapped = graphToWorkspaceDataset(graph, "hypothesis", trimmed);
      setDataset(mapped);
      setSelectedNode(mapped.nodes[0] ?? null);

      const runId = `hyp-${Date.now()}`;
      const newRun: HypothesisTopicRun = {
        id: runId,
        title: trimmed,
        updatedAt: new Date().toISOString(),
        dataset: mapped,
      };
      setActiveRunId(runId);
      persistHistory([newRun, ...history.filter((c) => c.title !== trimmed)]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `HypothesisGraph failed: ${err.message}`
          : "Could not reach /api/topics. Make sure the backend is running."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runTopicSearch(query);
  };

  const edgeSourceLabel =
    selectedEdge && dataset
      ? dataset.nodes.find((n) => n.id === selectedEdge.source)?.label ?? selectedEdge.source
      : "";
  const edgeTargetLabel =
    selectedEdge && dataset
      ? dataset.nodes.find((n) => n.id === selectedEdge.target)?.label ?? selectedEdge.target
      : "";

  const supportsCount = dataset?.edges.filter((e) => e.type === "supports").length ?? 0;
  const contradictsCount = dataset?.edges.filter((e) => e.type === "contradicts").length ?? 0;
  const gapCount = dataset?.edges.filter((e) => e.type === "gap").length ?? 0;

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-purple-500/60 hover:text-purple-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Home
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400">
            <GitCompare className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100">HypothesisGraph</h1>
            <p className="text-[11px] text-slate-400">
              Grounded Multi-Paper Evidence, Contradictions & Gaps
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              historyOpen
                ? "border-purple-500/50 bg-purple-500/15 text-purple-300"
                : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Saved Topics ({history.length})
          </button>
          <button
            type="button"
            onClick={startNewTopic}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-purple-500/60 hover:text-purple-300"
          >
            <Plus className="h-3.5 w-3.5 text-purple-400" />
            New Topic
          </button>
          <a
            href="/tutor"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Live Tutor
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Saved Topics Sidebar */}
        {historyOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/50">
            <div className="flex items-center justify-between border-b border-slate-800 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Previous Topics
              </span>
              <button
                type="button"
                onClick={startNewTopic}
                className="text-[11px] font-medium text-purple-400 hover:text-purple-300"
              >
                + New
              </button>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
              {history.length === 0 ? (
                <p className="px-2 py-4 text-center text-[11px] text-slate-500">
                  Generated paper graphs will be saved here.
                </p>
              ) : (
                history.map((run) => {
                  const active = run.id === activeRunId;
                  return (
                    <div
                      key={run.id}
                      onClick={() => openRun(run)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openRun(run);
                        }
                      }}
                      className={`group flex cursor-pointer items-start justify-between gap-2 rounded-lg border px-2.5 py-2 transition ${
                        active
                          ? "border-purple-500/50 bg-purple-500/10"
                          : "border-transparent hover:border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-200">{run.title}</p>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDate(run.updatedAt)}
                          </span>
                          <span>{run.dataset.nodes.length} nodes</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete ${run.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRun(run.id);
                        }}
                        className="rounded p-1 text-slate-500 opacity-0 transition hover:bg-slate-800 hover:text-rose-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* Main Topic Query + Full-Space Graph */}
        <main
          className={`flex min-h-0 flex-1 flex-col px-4 py-4 ${
            dataset ? "justify-start" : "justify-center"
          }`}
        >
          <div className={`mx-auto w-full ${dataset ? "max-w-4xl" : "max-w-2xl"}`}>
            {!dataset && (
              <div className="mb-6 text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-[11px] font-medium text-purple-300">
                  <Sparkles className="h-3 w-3" />
                  arXiv · bioRxiv · PubMed · Semantic Scholar
                </span>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-100">
                  Generate a Grounded Paper Graph
                </h2>
                <p className="mt-1.5 text-xs text-slate-400">
                  Enter a research topic or speak into the mic to retrieve grounded papers and map
                  supporting evidence, contradictions, and research gaps.
                </p>
              </div>
            )}

            {/* Topic Query Input with Mic */}
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 rounded-2xl border border-purple-500/40 bg-slate-900/90 p-2 shadow-2xl shadow-purple-950/20"
            >
              <button
                type="button"
                onClick={toggleMic}
                aria-label={listening ? "Stop microphone" : "Start microphone"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                  listening
                    ? "animate-pulse bg-rose-500 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-purple-300"
                }`}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter a research topic or query (e.g. Chinchilla scaling laws)..."
                className="flex-1 bg-transparent px-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-purple-500 px-4 text-xs font-semibold text-slate-950 transition hover:bg-purple-400 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Generate Graph
                  </>
                )}
              </button>
            </form>

            {errorMsg && (
              <p className="mt-3 rounded-xl border border-rose-800/60 bg-rose-950/40 px-4 py-2 text-xs text-rose-300">
                {errorMsg}
              </p>
            )}

            {!dataset && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {STARTER_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => runTopicSearch(q)}
                    className="rounded-full border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-purple-500/50 hover:text-purple-300"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Large Full-Space Hypothesis Graph */}
          {dataset && (
            <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 lg:grid-cols-[1fr_310px]">
              <div className="relative flex min-h-0 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-slate-200">{dataset.title}</span>
                    <span className="text-[11px] text-slate-400">
                      {dataset.nodes.length} nodes · {supportsCount} supports · {contradictsCount}{" "}
                      contradicts · {gapCount} gaps
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Click a node to zoom its neighbourhood · Click a link for explanation
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Supports
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      Contradicts
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-purple-500" />
                      Gap
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-slate-600" />
                      Detached
                    </span>
                  </div>
                </div>

                <div className="relative min-h-0 flex-1">
                  <GraphCanvas
                    nodes={dataset.nodes}
                    edges={dataset.edges}
                    selectedNodeId={selectedNode?.id ?? null}
                    selectedEdgeId={selectedEdge?.id ?? null}
                    annotations={[]}
                    onSelectNode={(n) => setSelectedNode(n)}
                    onSelectEdge={(edge) => setSelectedEdge(edge)}
                  />

                  {/* Nice Edge Explanation Box on Link Click */}
                  {selectedEdge && (
                    <div className="absolute bottom-4 left-4 right-4 z-20 mx-auto max-w-xl rounded-2xl border border-purple-500/40 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                              EDGE_BADGE[selectedEdge.type].cls
                            }`}
                          >
                            {EDGE_BADGE[selectedEdge.type].label}
                          </span>
                          <span className="text-xs font-medium text-slate-300">
                            {edgeSourceLabel} → {edgeTargetLabel}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedEdge(null)}
                          aria-label="Close edge explanation"
                          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="mt-2.5 text-xs leading-relaxed text-slate-200">
                        {selectedEdge.label ||
                          selectedEdge.condition ||
                          "Grounded relationship linking these two claims/papers."}
                      </p>

                      {selectedEdge.evidence && selectedEdge.evidence.length > 0 && (
                        <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Grounded Evidence
                          </p>
                          {selectedEdge.evidence.map((ev, idx) => (
                            <blockquote
                              key={`${ev.paper_id}-${idx}`}
                              className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] italic text-slate-300"
                            >
                              “{ev.quote}”
                            </blockquote>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <aside className="overflow-y-auto border-t border-slate-800 bg-slate-900/70 p-4 lg:border-t-0 lg:border-l">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                  Node Citation & Summary
                </p>
                {selectedNode ? (
                  <div className="mt-3 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-100">{selectedNode.label}</h3>
                    {(selectedNode.authors_year || selectedNode.slide_ref) && (
                      <div className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-medium text-sky-300">
                        <BookOpen className="h-3.5 w-3.5 shrink-0" />
                        <span>{selectedNode.authors_year || selectedNode.slide_ref}</span>
                      </div>
                    )}
                    <p className="text-xs leading-relaxed text-slate-300">{selectedNode.summary}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">
                    Click a node to inspect its citation and zoom into its neighbourhood.
                  </p>
                )}
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
