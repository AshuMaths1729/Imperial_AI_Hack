"use client";

import React, { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  BookOpen,
  Clock,
  ExternalLink,
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
import { createTopicGraph, stt } from "../api/endpoints";
import { graphToWorkspaceDataset } from "../api/adapters";
import { extractGraphCitations, formatCitationLabel, resolveCitationUrl } from "../api/citations";
import { GraphEdgeData, GraphNodeData, WorkspaceDataset } from "../types/scholartwin";
import { GraphCanvas } from "./GraphCanvas";
import { ThemeToggle } from "./ThemeProvider";

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

const EDGE_BADGE: Record<GraphEdgeData["type"], { label: string; colorVar: string; softVar: string; borderVar: string }> = {
  supports: {
    label: "Supports",
    colorVar: "var(--status-support)",
    softVar: "var(--status-support-soft)",
    borderVar: "var(--status-support-border)",
  },
  contradicts: {
    label: "Contradicts",
    colorVar: "var(--status-contradict)",
    softVar: "var(--status-contradict-soft)",
    borderVar: "var(--status-contradict-border)",
  },
  gap: {
    label: "Research Gap",
    colorVar: "var(--status-gap)",
    softVar: "var(--status-gap-soft)",
    borderVar: "var(--status-gap-border)",
  },
  prerequisite: {
    label: "Prerequisite",
    colorVar: "var(--accent)",
    softVar: "var(--accent-soft)",
    borderVar: "var(--accent-border)",
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
  const [transcribing, setTranscribing] = useState(false);
  const [dataset, setDataset] = useState<WorkspaceDataset | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecCtor> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  const toggleMic = async () => {
    setErrorMsg(null);
    if (listening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        audioChunksRef.current = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
        };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size === 0) return;
          setTranscribing(true);
          try {
            const res = await stt(blob);
            const text = res.transcript?.trim();
            if (text) setQuery((prev) => (prev ? `${prev} ${text}` : text));
          } catch (err) {
            setErrorMsg(
              err instanceof Error ? `Voice transcription failed: ${err.message}` : "Voice transcription failed."
            );
          } finally {
            setTranscribing(false);
          }
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
        setListening(true);
        return;
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? `Microphone error: ${err.message}` : "Microphone permission denied."
        );
        return;
      }
    }

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setErrorMsg("Microphone recording is unavailable in this browser. Type your topic below.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const transcript = ev.results?.[0]?.[0]?.transcript;
      if (transcript) setQuery((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => {
      setListening(false);
      setErrorMsg("Browser speech recognition failed. Type your topic below.");
    };
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
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="apple-glass z-30 flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--status-gap-border)] hover:text-[var(--status-gap)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Home
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--status-gap-soft)] text-[var(--status-gap)]">
            <GitCompare className="h-4 w-4" />
          </div>
          <div>
            <h1 className="apple-heading text-sm font-bold text-[var(--text-primary)]">HypothesisGraph</h1>
            <p className="text-[11px] text-[var(--text-muted)]">
              Grounded Multi-Paper Evidence, Contradictions & Gaps
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            style={
              historyOpen
                ? {
                    borderColor: "var(--status-gap-border)",
                    backgroundColor: "var(--status-gap-soft)",
                    color: "var(--status-gap)",
                  }
                : undefined
            }
            className={`apple-press apple-focus flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
              !historyOpen
                ? "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                : ""
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Saved Topics ({history.length})
          </button>
          <button
            type="button"
            onClick={startNewTopic}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--status-gap-border)] hover:text-[var(--status-gap)]"
          >
            <Plus className="h-3.5 w-3.5 text-[var(--status-gap)]" />
            New Topic
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

      <div className="flex min-h-0 flex-1">
        {/* Saved Topics Sidebar */}
        {historyOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2.5">
              <span className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                Previous Topics
              </span>
              <button
                type="button"
                onClick={startNewTopic}
                className="apple-focus text-[11px] font-semibold text-[var(--status-gap)] hover:opacity-80"
              >
                + New
              </button>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
              {history.length === 0 ? (
                <p className="px-2 py-4 text-center text-[11px] text-[var(--text-muted)]">
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
                      style={
                        active
                          ? {
                              borderColor: "var(--status-gap-border)",
                              backgroundColor: "var(--status-gap-soft)",
                            }
                          : undefined
                      }
                      className={`apple-press apple-focus group flex cursor-pointer items-start justify-between gap-2 rounded-xl border px-2.5 py-2 ${
                        !active
                          ? "border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--bg-surface-muted)]"
                          : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--text-primary)]">{run.title}</p>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
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
                        className="apple-focus rounded p-1 text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--status-contradict-soft)] hover:text-[var(--status-contradict)] group-hover:opacity-100 focus-visible:opacity-100"
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
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-gap-border)] bg-[var(--status-gap-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--status-gap)]">
                  <Sparkles className="h-3 w-3" />
                  arXiv · bioRxiv · PubMed · Semantic Scholar
                </span>
                <h2 className="apple-display mt-3 text-2xl font-bold text-[var(--text-primary)]">
                  Generate a Grounded Paper Graph
                </h2>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Enter a research topic or speak into the mic to retrieve grounded papers and map
                  supporting evidence, contradictions, and research gaps.
                </p>
              </div>
            )}

            {/* Topic Query Input with Mic */}
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 rounded-2xl border border-[var(--status-gap-border)] bg-[var(--bg-surface)] p-2 shadow-lg"
            >
              <button
                type="button"
                onClick={toggleMic}
                disabled={transcribing}
                aria-label={listening ? "Stop microphone" : "Start microphone"}
                title={listening ? "Click to stop & transcribe" : "Speak research topic"}
                className={`apple-press apple-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  listening
                    ? "animate-pulse bg-[var(--status-contradict)] text-white"
                    : transcribing
                    ? "bg-[var(--status-gap-soft)] text-[var(--status-gap)]"
                    : "bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--status-gap)]"
                }`}
              >
                {transcribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : listening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter a research topic or query (e.g. Chinchilla scaling laws)..."
                className="flex-1 bg-transparent px-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                style={{
                  backgroundColor: "var(--status-gap)",
                  color: "var(--accent-fg)",
                }}
                className="apple-press apple-focus flex h-10 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
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
              <p className="mt-3 rounded-xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-4 py-2 text-xs text-[var(--status-contradict)]">
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
                    className="apple-press apple-focus rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--status-gap-border)] hover:text-[var(--status-gap)]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Large Full-Space Hypothesis Graph */}
          {dataset && (
            <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:grid-cols-[1fr_310px]">
              <div className="relative flex min-h-0 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{dataset.title}</span>
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      {dataset.nodes.length} nodes · {supportsCount} supports · {contradictsCount}{" "}
                      contradicts · {gapCount} gaps
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Click a node to zoom its neighbourhood · Click a link for explanation
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-medium text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--status-support)]" />
                      Supports
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--status-contradict)]" />
                      Contradicts
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--status-gap)]" />
                      Gap
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--text-muted)]" />
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
                    <div className="apple-glass-elevated apple-materialize absolute bottom-4 left-4 right-4 z-20 mx-auto max-w-xl rounded-2xl border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            style={{
                              color: EDGE_BADGE[selectedEdge.type].colorVar,
                              backgroundColor: EDGE_BADGE[selectedEdge.type].softVar,
                              borderColor: EDGE_BADGE[selectedEdge.type].borderVar,
                            }}
                            className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                          >
                            {EDGE_BADGE[selectedEdge.type].label}
                          </span>
                          <span className="text-xs font-medium text-[var(--text-secondary)]">
                            {edgeSourceLabel} → {edgeTargetLabel}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedEdge(null)}
                          aria-label="Close edge explanation"
                          className="apple-press apple-focus rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-primary)]">
                        {selectedEdge.label ||
                          selectedEdge.condition ||
                          "Grounded relationship linking these two claims/papers."}
                      </p>

                      {selectedEdge.evidence && selectedEdge.evidence.length > 0 && (
                        <div className="mt-3 space-y-1.5 border-t border-[var(--border-subtle)] pt-2.5">
                          <p className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                            Grounded Evidence
                          </p>
                          {selectedEdge.evidence.map((ev, idx) => (
                            <blockquote
                              key={`${ev.paper_id}-${idx}`}
                              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-[11px] italic text-[var(--text-secondary)]"
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

              <aside className="flex flex-col gap-5 overflow-y-auto border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 lg:border-t-0 lg:border-l">
                <div>
                  <p className="apple-label text-[11px] font-semibold uppercase text-[var(--status-gap)]">
                    Node Citation & Summary
                  </p>
                  {selectedNode ? (
                    <div className="mt-3 space-y-3">
                      <h3 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
                        {selectedNode.label}
                      </h3>
                      {(selectedNode.authors_year || selectedNode.slide_ref || selectedNode.doc_id || selectedNode.category === "paper") && (() => {
                        const docId = selectedNode.doc_id || (selectedNode.category === "paper" ? selectedNode.id : undefined);
                        const citText =
                          selectedNode.authors_year ||
                          selectedNode.slide_ref ||
                          formatCitationLabel(docId) ||
                          selectedNode.label;
                        const citUrl = resolveCitationUrl({
                          docId,
                          citation: selectedNode.authors_year || selectedNode.slide_ref,
                          title: selectedNode.label,
                        });
                        return citUrl ? (
                          <a
                            href={citUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="apple-press apple-focus flex items-center justify-between gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent)] hover:opacity-90"
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <BookOpen className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{citText}</span>
                            </span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent)]">
                            <BookOpen className="h-3.5 w-3.5 shrink-0" />
                            <span>{citText}</span>
                          </div>
                        );
                      })()}
                      <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                        {selectedNode.summary}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--text-muted)]">
                      Click a node or a citation below to inspect it and zoom into its neighbourhood.
                    </p>
                  )}
                </div>

                {/* Clickable Graph Citations */}
                {(() => {
                  const citations = extractGraphCitations(dataset.nodes, dataset.edges);
                  if (citations.length === 0) return null;
                  return (
                    <div className="border-t border-[var(--border-subtle)] pt-4">
                      <div className="mb-2.5 flex items-center justify-between">
                        <p className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                          Graph Citations ({citations.length})
                        </p>
                      </div>
                      <div className="space-y-2">
                        {citations.map((cit) => {
                          const targetNode = cit.nodeId
                            ? dataset.nodes.find((n) => n.id === cit.nodeId)
                            : undefined;
                          const isSelected = Boolean(cit.nodeId && selectedNode?.id === cit.nodeId);
                          return (
                            <div
                              key={cit.id}
                              className={`apple-press flex items-start justify-between gap-2 rounded-xl border p-2.5 transition ${
                                isSelected
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                  : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (targetNode) {
                                    setSelectedNode(targetNode);
                                    setSelectedEdge(null);
                                  } else if (cit.url) {
                                    window.open(cit.url, "_blank", "noopener,noreferrer");
                                  }
                                }}
                                className="apple-focus min-w-0 flex-1 text-left"
                              >
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                    {cit.citation}
                                  </p>
                                  {cit.isDetached && (
                                    <span className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-muted)]">
                                      Unlinked
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--text-muted)]">
                                  {cit.title}
                                </p>
                                {cit.evidenceCount > 0 && (
                                  <span className="mt-1 inline-block text-[10px] font-medium text-[var(--accent)]">
                                    {cit.evidenceCount} grounded {cit.evidenceCount === 1 ? "quote" : "quotes"}
                                  </span>
                                )}
                              </button>
                              {cit.url && (
                                <a
                                  href={cit.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open source for ${cit.citation}`}
                                  title="Open paper / search citation"
                                  className="apple-press apple-focus shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--accent)]"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
