"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowRight,
  GitCompare,
  Loader2,
  Mic,
  MicOff,
  MousePointerClick,
  Search,
  Sparkles,
} from "lucide-react";
import { createTopicGraph, stt } from "../api/endpoints";
import { graphToWorkspaceDataset } from "../api/adapters";
import { GraphEdgeData } from "../types/scholartwin";
import { GraphCanvas } from "./GraphCanvas";
import { AppHeader } from "./AppHeader";
import { TopicSidebar, type TopicRun } from "./hypothesis/TopicSidebar";
import { EvidenceGlyph, EvidenceLegend, SearchProgress, StarterTopics } from "./hypothesis/EvidenceHero";
import { buildHypothesisModel } from "./hypothesis/model";
import { EdgeBubble, NodeBubble } from "./hypothesis/Bubbles";
import { PaperList } from "./hypothesis/PaperList";

export type HypothesisTopicRun = TopicRun;

interface HypothesisChatViewProps {
  onBackHome: () => void;
}

const HISTORY_STORAGE_KEY = "scholartwin.hypothesis.history.v1";

const STARTER_QUERIES = [
  "Compute-optimal scaling laws: Chinchilla vs Kaplan",
  "Does chain-of-thought prompting improve mathematical reasoning reliability?",
  "LoRA vs full fine-tuning generalization on domain-specific tasks",
] as const;

/** Keep focused nodes in the top half: the details bubble covers the bottom of the canvas. */
const FOCUS_PADDING = { top: "12%", left: "10%", right: "10%", bottom: "50%" } as const;

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

function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function StatChip({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {n} {label}
    </span>
  );
}

export function HypothesisChatView({ onBackHome }: HypothesisChatViewProps) {
  const history = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getServerHistorySnapshot);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [dataset, setDataset] = useState<HypothesisTopicRun["dataset"] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecCtor> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Paper-level graph: papers and open questions as nodes, claims inside their paper.
  const model = useMemo(() => (dataset ? buildHypothesisModel(dataset) : null), [dataset]);
  // Saved topics may remember a claim id; it now lives inside its paper.
  const shownId = model ? model.resolveId(selectedId) : null;
  const selectedNode = (shownId && model?.byId.get(shownId)) || null;

  // Each paper node says how many claims it holds and how many of them link out.
  const nodeMeta = useCallback(
    (id: string) => {
      const claims = model?.claimsOf.get(id);
      if (!model || !claims?.length) return undefined;
      const linked = claims.filter((c) => model.claimLinks.has(c.id)).length;
      const n = `${claims.length} ${claims.length === 1 ? "claim" : "claims"}`;
      return linked ? `${n} · ${linked} linked` : `${n} · none linked`;
    },
    [model]
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setSelectedEdge(null);
  }, []);

  // Esc closes the details bubble.
  useEffect(() => {
    if (!selectedId && !selectedEdge) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedEdge, clearSelection]);

  const startNewTopic = () => {
    setActiveRunId(null);
    setDataset(null);
    setSelectedId(null);
    setSelectedEdge(null);
    setErrorMsg(null);
    setQuery("");
    if (isNarrowScreen()) setSidebarCollapsed(true);
  };

  const openRun = (run: HypothesisTopicRun) => {
    setActiveRunId(run.id);
    setQuery(run.title);
    setDataset(run.dataset);
    // Back to the node last clicked in this topic, else the whole chart (no auto-zoom).
    setSelectedId(run.dataset.nodes.some((n) => n.id === run.lastNodeId) ? run.lastNodeId! : null);
    setSelectedEdge(null);
    setErrorMsg(null);
    if (isNarrowScreen()) setSidebarCollapsed(true);
  };

  const selectNode = (id: string) => {
    setSelectedId(id);
    setSelectedEdge(null);
    if (activeRunId) {
      persistHistory(history.map((r) => (r.id === activeRunId ? { ...r, lastNodeId: id } : r)));
    }
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
        setErrorMsg(err instanceof Error ? `Microphone error: ${err.message}` : "Microphone permission denied.");
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
      setSelectedId(null); // open on the whole chart

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


  const hero = !dataset;

  const searchForm = (
    <form
      onSubmit={handleSubmit}
      style={hero ? ({ "--st-glow-a": "var(--status-gap)", "--st-glow-b": "var(--status-support)" } as React.CSSProperties) : undefined}
      className={`relative flex items-center gap-2 rounded-2xl border border-[var(--status-gap-border)] bg-[var(--bg-surface)] transition-[border-color,box-shadow] duration-300 focus-within:border-[var(--status-gap)] focus-within:shadow-[0_0_0_4px_var(--status-gap-soft)] ${
        hero ? "st-glow-border p-2.5 shadow-xl" : "p-2 shadow-lg"
      }`}
    >
      <button
        type="button"
        onClick={toggleMic}
        disabled={transcribing}
        aria-label={listening ? "Stop microphone" : "Start microphone"}
        title={listening ? "Click to stop & transcribe" : "Speak research topic"}
        className={`apple-press apple-focus relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
          listening
            ? "bg-[var(--status-contradict)] text-[var(--status-contradict-fg)]"
            : transcribing
              ? "bg-[var(--status-gap-soft)] text-[var(--status-gap)]"
              : "bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:bg-[var(--status-gap-soft)] hover:text-[var(--status-gap)]"
        }`}
      >
        {listening && (
          <span aria-hidden className="absolute inset-0 rounded-xl bg-[var(--status-contradict)] motion-safe:animate-ping" style={{ opacity: 0.35 }} />
        )}
        {transcribing ? (
          <Loader2 className="relative h-4 w-4 animate-spin" />
        ) : listening ? (
          <MicOff className="relative h-4 w-4" />
        ) : (
          <Mic className="relative h-4 w-4" />
        )}
      </button>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={listening ? "Listening… click the mic again to stop" : "Enter a research topic or question (e.g. Chinchilla scaling laws)…"}
        aria-label="Research topic or question"
        className={`min-w-0 flex-1 bg-transparent px-2 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none ${
          hero ? "text-[15px]" : "text-sm"
        }`}
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        style={{ backgroundColor: "var(--status-gap)", color: "var(--accent-fg)" }}
        className="apple-press apple-focus st-sheen group relative flex h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-xl px-4 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="hidden sm:inline">Generating…</span>
          </>
        ) : (
          <>
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Generate graph</span>
            <ArrowRight className="hidden h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 sm:block" />
          </>
        )}
      </button>
    </form>
  );

  const errorBox = errorMsg && (
    <div
      role="alert"
      className="st-shake mt-3 flex items-start gap-2 rounded-xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3.5 py-2 text-xs text-[var(--status-contradict)]"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{errorMsg}</span>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <AppHeader
        tone="gap"
        back={{ label: "Home", onClick: onBackHome }}
        icon={GitCompare}
        title="HypothesisGraph"
        subtitle="Grounded multi-paper evidence, contradictions & gaps"
      />

      <div className="relative flex min-h-0 flex-1">
        {/* On phones the rail stays in flow and the expanded panel overlays the page. */}
        <div className="relative z-30 flex w-[60px] shrink-0 md:w-auto">
          <TopicSidebar
            runs={history}
            activeRunId={activeRunId}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
            onNewTopic={startNewTopic}
            onOpenRun={openRun}
            onDeleteRun={deleteRun}
          />
        </div>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {hero ? (
            <>
              {/* Ambient animated backdrop */}
              <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="apple-hero-glow absolute inset-x-0 top-0 h-[420px]" />
                <div className="st-aurora absolute -top-40 left-[calc(50%-380px)] h-[460px] w-[760px] rounded-full bg-[var(--status-gap-soft)] blur-3xl" />
                <div className="st-aurora-slow absolute bottom-0 -left-32 h-[340px] w-[340px] rounded-full bg-[var(--status-support-soft)] blur-3xl" />
                <div className="st-aurora-slow absolute -right-24 top-1/3 h-[300px] w-[300px] rounded-full bg-[var(--status-contradict-soft)] blur-3xl" />
                <div className="st-grid absolute inset-0 opacity-[0.3]" />
              </div>

              <div className="relative z-10 flex flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-6">
                <div className="mx-auto my-auto w-full max-w-2xl">
                  <div className="st-fade-up mx-auto mb-2 w-full max-w-[400px]">
                    <EvidenceGlyph busy={loading} className="st-float h-auto w-full" />
                  </div>
                  <div className="text-center">
                    <span
                      className="st-fade-up inline-flex items-center gap-1.5 rounded-full border border-[var(--status-gap-border)] bg-[var(--status-gap-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--status-gap)]"
                      style={{ animationDelay: "80ms" }}
                    >
                      <Sparkles className="st-twinkle h-3 w-3" />
                      arXiv · bioRxiv · PubMed · Semantic Scholar
                    </span>
                    {/* leading/padding leave room for descenders, which bg-clip-text would otherwise cut */}
                    <h2
                      className="apple-display st-fade-up mt-3 bg-gradient-to-r from-[var(--status-gap)] via-[var(--text-primary)] to-[var(--status-support)] bg-clip-text pb-1.5 text-2xl font-bold !leading-[1.25] text-transparent sm:text-3xl"
                      style={{ animationDelay: "140ms" }}
                    >
                      Map what the literature agrees on, and where it doesn&apos;t
                    </h2>
                    <p
                      className="st-fade-up mx-auto mt-2 max-w-xl text-sm text-[var(--text-secondary)]"
                      style={{ animationDelay: "200ms" }}
                    >
                      Type a research question or speak it into the mic. We find grounded papers and map the
                      evidence that supports it, contradicts it, and the gaps nobody has filled yet.
                    </p>
                  </div>

                  <div className="st-fade-up mt-6" style={{ animationDelay: "260ms" }}>
                    {searchForm}
                  </div>
                  {loading && <SearchProgress />}
                  {errorBox}

                  <div className="mt-5">
                    <p
                      className="st-fade-up apple-label mb-2 text-center text-[10px] font-semibold uppercase text-[var(--text-muted)]"
                      style={{ animationDelay: "320ms" }}
                    >
                      Try one of these
                    </p>
                    <StarterTopics topics={STARTER_QUERIES} disabled={loading} onPick={runTopicSearch} baseDelay={360} />
                  </div>

                  <div className="mt-8">
                    <EvidenceLegend baseDelay={520} />
                  </div>
                </div>
              </div>
            </>
          ) : model ? (
            <div className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">
              {/* Full-space hypothesis graph (new searches start from "New topic" in the sidebar) */}
              <div
                key={activeRunId ?? dataset.title}
                className="st-fade-up grid min-h-0 flex-1 grid-cols-1 overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm lg:grid-cols-[minmax(0,1fr)_300px] lg:overflow-hidden"
              >
                <div className="relative flex min-h-[72vh] flex-col lg:min-h-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[var(--border-subtle)] px-4 py-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <h2
                        title={dataset.title}
                        className="apple-heading mr-1 max-w-[26rem] truncate text-sm font-semibold text-[var(--text-primary)]"
                      >
                        {dataset.title}
                      </h2>
                      <StatChip n={model.counts.paper} label={model.counts.paper === 1 ? "paper" : "papers"} color="var(--accent)" />
                      <StatChip n={model.counts.supports} label={model.counts.supports === 1 ? "agreement" : "agreements"} color="var(--status-support)" />
                      <StatChip n={model.counts.contradicts} label={model.counts.contradicts === 1 ? "contradiction" : "contradictions"} color="var(--status-contradict)" />
                      <StatChip n={model.counts.gap} label={model.counts.gap === 1 ? "open question" : "open questions"} color="var(--status-gap)" />
                    </div>
                    {model.counts.unlinked > 0 && (
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {model.counts.unlinked} {model.counts.unlinked === 1 ? "paper stands" : "papers stand"} alone (greyed out, bottom row)
                      </span>
                    )}
                  </div>

                  <div className="relative min-h-[420px] flex-1">
                    <GraphCanvas
                      nodes={model.nodes}
                      edges={model.edges}
                      focusPadding={FOCUS_PADDING}
                      nodeMeta={nodeMeta}
                      selectedNodeId={shownId}
                      selectedEdgeId={selectedEdge?.id ?? null}
                      annotations={[]}
                      onSelectNode={(n) => selectNode(n.id)}
                      onSelectEdge={(edge) => setSelectedEdge(edge)}
                      onClearSelection={clearSelection}
                    />

                    {selectedEdge ? (
                      <EdgeBubble
                        key={selectedEdge.id}
                        model={model}
                        edge={selectedEdge}
                        onSelectNode={selectNode}
                        onBack={selectedNode ? () => setSelectedEdge(null) : undefined}
                        onClose={clearSelection}
                      />
                    ) : (
                      selectedNode && (
                        <NodeBubble
                          key={selectedNode.id}
                          model={model}
                          node={selectedNode}
                          onSelectNode={selectNode}
                          onShowEdge={(edge) => setSelectedEdge(edge)}
                          onClose={clearSelection}
                          highlightClaimId={selectedId !== shownId ? selectedId : null}
                        />
                      )
                    )}

                    {!selectedNode && !selectedEdge && (
                      <p className="apple-glass pointer-events-none absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] text-[var(--text-secondary)] sm:flex">
                        <MousePointerClick className="h-3.5 w-3.5 text-[var(--status-gap)]" />
                        Click a paper to see its claims and links · click a line to see why
                      </p>
                    )}
                  </div>
                </div>

                <aside
                  aria-label="Papers in this topic"
                  className="flex h-[60vh] min-h-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:h-auto lg:border-l lg:border-t-0"
                >
                  <PaperList model={model} selectedId={selectedId} onSelect={selectNode} />
                </aside>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
