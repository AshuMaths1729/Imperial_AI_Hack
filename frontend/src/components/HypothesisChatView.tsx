"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ArrowRight, Loader2, Mic, MicOff, MousePointerClick } from "lucide-react";
import { createTopicGraph, stt } from "../api/endpoints";
import { graphToWorkspaceDataset } from "../api/adapters";
import { GraphEdgeData } from "../types/scholartwin";
import { EdgeSwatch, GraphCanvas } from "./GraphCanvas";
import { AppHeader } from "./AppHeader";
import { TopicSidebar, type TopicRun } from "./hypothesis/TopicSidebar";
import { SearchProgress, StarterTopics } from "./hypothesis/EvidenceHero";
import { buildHypothesisModel } from "./hypothesis/model";
import { EdgeDetails, NodeDetails, QuestionDetails, type DetailVariant } from "./hypothesis/Details";
import { PaperList } from "./hypothesis/PaperList";
import { MODULES } from "../modules";

export type HypothesisTopicRun = TopicRun;

interface HypothesisChatViewProps {
  onBackHome: () => void;
  /** Open this saved topic (a history entry id) on arrival, e.g. from Home's recent list. */
  initialTopicId?: string;
}

const HISTORY_STORAGE_KEY = "scholartwin.hypothesis.history.v1";

const STARTER_QUERIES = [
  "Compute-optimal scaling laws: Chinchilla vs Kaplan",
  "Does chain-of-thought prompting improve mathematical reasoning reliability?",
  "LoRA vs full fine-tuning generalization on domain-specific tasks",
] as const;

/** Focus zooms. With the details in the side panel the map is free all round; with the details
 *  bubble docked to the bottom of the map (narrower screens), focused nodes stay in the top half. */
const PANEL_FOCUS_PADDING = { top: "12%", left: "10%", right: "10%", bottom: "12%" } as const;
const BUBBLE_FOCUS_PADDING = { top: "10%", left: "10%", right: "10%", bottom: "56%" } as const;

const MODULE = MODULES.hypothesis;

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

/* Screen-size breakpoints as external stores (no setState in effects, no hydration guesswork). */
const PHONE_QUERY = "(max-width: 767px)"; // the sidebar overlays the page below md
const WIDE_QUERY = "(min-width: 1024px)"; // the details move into the side panel from lg
// Below xl the open sidebar plus the details panel squeezed the map to ~350px, so it starts collapsed there.
const ROOMY_QUERY = "(min-width: 1280px)";

function mediaStore(query: string) {
  return {
    subscribe: (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    get: () => window.matchMedia(query).matches,
  };
}
const phoneStore = mediaStore(PHONE_QUERY);
const wideStore = mediaStore(WIDE_QUERY);
const roomyStore = mediaStore(ROOMY_QUERY);
const serverFalse = () => false;
const serverTrue = () => true;

/** A glass capsule that is both a legend entry (the line's colour and dash) and a count. */
function CountChip({ type, label, n }: { type: GraphEdgeData["type"]; label: string; n: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-1 text-[11px] font-medium leading-none sm:px-2.5 sm:text-[11.5px] text-[var(--text-secondary)]">
      <EdgeSwatch type={type} width={16} />
      {label}
      <span className="font-semibold tabular-nums text-[var(--text-primary)]">{n}</span>
    </span>
  );
}

export function HypothesisChatView({ onBackHome, initialTopicId }: HypothesisChatViewProps) {
  const history = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getServerHistorySnapshot);
  const phone = useSyncExternalStore(phoneStore.subscribe, phoneStore.get, serverFalse);
  const wide = useSyncExternalStore(wideStore.subscribe, wideStore.get, serverFalse);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const roomy = useSyncExternalStore(roomyStore.subscribe, roomyStore.get, serverTrue);
  // null = follow the screen: collapsed on phones (the open sidebar covers the page) and below 1280px
  // (sidebar + details would squeeze the map).
  const [collapsedPref, setCollapsedPref] = useState<boolean | null>(null);
  const sidebarCollapsed = collapsedPref ?? (phone || !roomy);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [dataset, setDataset] = useState<HypothesisTopicRun["dataset"] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdgeData | null>(null);
  const [arrivedFor, setArrivedFor] = useState<string | null>(null);
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

  // Esc closes the details.
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
    if (phone) setCollapsedPref(true);
  };

  const openRun = (run: HypothesisTopicRun) => {
    setActiveRunId(run.id);
    setQuery(run.title);
    setDataset(run.dataset);
    // Back to the node last clicked in this topic, else the whole chart (no auto-zoom).
    setSelectedId(run.dataset.nodes.some((n) => n.id === run.lastNodeId) ? run.lastNodeId! : null);
    setSelectedEdge(null);
    setErrorMsg(null);
    if (phone) setCollapsedPref(true);
  };

  // Arriving with a saved topic (e.g. from Home's recent list) opens it straight away. Derived
  // during render, not in an effect: React re-renders with the topic before anything paints.
  if (initialTopicId && arrivedFor !== initialTopicId) {
    const run = history.find((r) => r.id === initialTopicId);
    if (run) {
      setArrivedFor(initialTopicId);
      openRun(run);
    }
  }

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
      setErrorMsg("Microphone recording is unavailable in this browser. Type your question instead.");
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
      setErrorMsg("Browser speech recognition failed. Type your question instead.");
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
          ? `Couldn't map that question: ${err.message}`
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
  const canSubmit = !!query.trim() && !loading;

  // The question bar: one thick glass capsule with a refracting rim, floating on the landscape.
  // On phones it wraps: the question gets the whole first line, mic and "Map it" sit below it.
  const searchForm = (
    <form
      onSubmit={handleSubmit}
      className="apple-sheet glass-lens relative flex flex-wrap items-center gap-1.5 rounded-[26px] py-1.5 pl-4 pr-1.5 transition-[outline-color] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--status-gap)] sm:flex-nowrap sm:rounded-full sm:pl-5"
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={listening ? "Listening… click the mic again to stop" : "Ask a research question, e.g. Chinchilla scaling laws"}
        aria-label="Research topic or question"
        className="min-w-0 flex-1 basis-full bg-transparent py-2.5 text-[15px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none sm:basis-auto sm:py-2"
      />
      <button
        type="button"
        onClick={toggleMic}
        disabled={transcribing}
        aria-label={listening ? "Stop microphone" : "Start microphone"}
        title={listening ? "Click to stop & transcribe" : "Speak your question"}
        className={`apple-press apple-focus relative ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition sm:ml-0 ${
          listening
            ? "border-transparent bg-[var(--status-contradict)] text-[var(--status-contradict-fg)]"
            : transcribing
              ? "border-[var(--status-gap-border)] bg-[var(--status-gap-soft)] text-[var(--status-gap)]"
              : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:border-[var(--status-gap-border)] hover:text-[var(--status-gap)]"
        }`}
      >
        {listening && (
          <span aria-hidden className="absolute inset-0 rounded-full bg-[var(--status-contradict)] motion-safe:animate-ping" style={{ opacity: 0.35 }} />
        )}
        {transcribing ? (
          <Loader2 className="relative h-4 w-4 animate-spin" />
        ) : listening ? (
          <MicOff className="relative h-4 w-4" />
        ) : (
          <Mic className="relative h-4 w-4" />
        )}
      </button>
      <button
        type="submit"
        disabled={!canSubmit}
        style={{ "--tint": "var(--status-gap)" } as React.CSSProperties}
        // Until there's a question to map, the button rests on the muted wash (readable, but
        // clearly not ready) instead of a faded tint.
        className={`apple-press apple-focus group relative flex h-11 shrink-0 items-center gap-1.5 overflow-hidden rounded-full px-4 text-[13.5px] font-semibold transition sm:px-5 ${
          canSubmit || loading
            ? "apple-tint st-sheen hover:brightness-110"
            : "cursor-not-allowed border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]"
        }`}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Mapping…</span>
          </>
        ) : (
          <>
            <span>Map it</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );

  const errorBox = errorMsg && (
    // On thick glass, so the message never sits straight on the landscape.
    <div role="alert" className="apple-sheet st-shake mt-4 overflow-hidden rounded-[20px]">
      <div
        className="flex items-start gap-2 bg-[var(--status-contradict-soft)] px-4 py-2.5 text-[12.5px] leading-relaxed"
        style={{ color: "color-mix(in srgb, var(--status-contradict) 82%, var(--text-primary))" }}
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{errorMsg}</span>
      </div>
    </div>
  );

  const detailVariant: DetailVariant = wide ? "panel" : "bubble";
  const detail = !model ? null : selectedEdge ? (
    <EdgeDetails
      key={selectedEdge.id}
      variant={detailVariant}
      model={model}
      edge={selectedEdge}
      onSelectNode={selectNode}
      onBack={selectedNode ? () => setSelectedEdge(null) : undefined}
      onClose={clearSelection}
    />
  ) : selectedNode ? (
    <NodeDetails
      key={selectedNode.id}
      variant={detailVariant}
      model={model}
      node={selectedNode}
      onSelectNode={selectNode}
      onShowEdge={(edge) => setSelectedEdge(edge)}
      onClose={clearSelection}
      highlightClaimId={selectedId !== shownId ? selectedId : null}
    />
  ) : null;
  const buildsOn = model ? model.edges.filter((e) => e.type === "prerequisite").length : 0;

  return (
    // Transparent root: the landscape shows through around the floating glass sheets.
    <div className="flex h-screen flex-col text-[var(--text-primary)]">
      <AppHeader
        tone={MODULE.tone}
        back={{ label: "Home", onClick: onBackHome }}
        icon={MODULE.icon}
        title={MODULE.name}
        subtitle={MODULE.description}
      />

      {/* Floating sheets inset from the edges, lined up with the header capsule. */}
      <div className="relative flex min-h-0 flex-1 gap-2.5 px-2 pb-2 pt-2.5 sm:px-3">
        {/* On phones the rail stays in flow and the expanded panel overlays the page. */}
        <div className="relative z-30 flex w-[60px] shrink-0 md:w-auto">
          <TopicSidebar
            runs={history}
            activeRunId={activeRunId}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setCollapsedPref(!sidebarCollapsed)}
            onNewTopic={startNewTopic}
            onOpenRun={openRun}
            onDeleteRun={deleteRun}
          />
        </div>

        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {hero ? (
            // The start screen sits straight on the landscape: a two-tone page head in scene ink,
            // then the glass question bar and the starter questions.
            // A stable gutter, so the column doesn't jump sideways when the loading card adds a scrollbar.
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
              <div className="mx-auto w-full max-w-[880px] px-1.5 pb-14 pt-[clamp(20px,7vh,76px)] sm:px-6">
                <p className="on-scene st-fade-up font-mono text-[11.5px] font-medium uppercase tracking-[0.14em]">
                  {MODULE.name}
                </p>
                <h2
                  className="st-display on-scene st-fade-up mt-3 text-[clamp(34px,5.4vw,62px)]"
                  style={{ animationDelay: "60ms" }}
                >
                  What does the research say? <span className="on-scene-soft">And where does it disagree?</span>
                </h2>
                <p
                  className="on-scene st-fade-up mt-4 max-w-[600px] text-[15.5px] font-medium leading-relaxed"
                  style={{ animationDelay: "120ms" }}
                >
                  Type a research question or speak it into the mic. We find grounded papers on arXiv, bioRxiv, PubMed
                  and Semantic Scholar and map the evidence that supports it, contradicts it, and the gaps nobody has
                  filled yet.
                </p>

                <div className="st-fade-up mt-7" style={{ animationDelay: "180ms" }}>
                  {searchForm}
                </div>
                {loading && <SearchProgress />}
                {errorBox}

                <div className="mt-7">
                  <p
                    className="on-scene st-fade-up mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em]"
                    style={{ animationDelay: "240ms" }}
                  >
                    Try one of these
                  </p>
                  <StarterTopics topics={STARTER_QUERIES} disabled={loading} onPick={runTopicSearch} baseDelay={280} />
                </div>
              </div>
            </div>
          ) : model ? (
            // The map on one thick glass sheet, the details and the list of papers on another.
            // New searches start from "New topic" in the sidebar. The negative margin spends the
            // row's padding so the sheets' shadows have room inside the scroll box.
            <div
              key={activeRunId ?? dataset.title}
              className="st-fade-up -m-2 grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-y-auto p-2 lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden"
            >
              <section
                aria-label="Evidence map"
                // Below lg the sheet takes its content's height (the map has a fixed height there),
                // so a wrapped header or footer can never push past the sheet's rim.
                className="apple-sheet relative flex min-w-0 flex-col rounded-[26px] lg:min-h-0"
              >
                <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border-subtle)] px-4 pb-3 pt-3.5 sm:px-5">
                  <h2
                    title={dataset.title}
                    // Up to two lines, so a long question still reads in full on a narrow map.
                    className="apple-heading line-clamp-2 min-w-0 break-words text-[17px] font-medium leading-snug text-[var(--text-primary)] sm:text-[19px]"
                  >
                    {dataset.title}
                  </h2>
                  {/* Counts double as the legend: each chip shows its line's colour and dash. */}
                  <div className="flex flex-wrap items-center gap-1.5" aria-label="Legend and counts">
                    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-1 text-[11px] font-medium leading-none sm:px-2.5 sm:text-[11.5px] text-[var(--text-secondary)]">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm bg-[var(--accent)]" />
                      Papers
                      <span className="font-semibold tabular-nums text-[var(--text-primary)]">{model.counts.paper}</span>
                    </span>
                    <CountChip type="supports" label="Supports" n={model.counts.supports} />
                    <CountChip type="contradicts" label="Contradicts" n={model.counts.contradicts} />
                    {buildsOn > 0 && <CountChip type="prerequisite" label="Builds on" n={buildsOn} />}
                    <CountChip type="gap" label="Open questions" n={model.counts.gap} />
                    {model.counts.unlinked > 0 && (
                      <span className="ml-1 text-[11.5px] text-[var(--text-muted)]">
                        {model.counts.unlinked} {model.counts.unlinked === 1 ? "paper stands" : "papers stand"} alone
                        (dashed, bottom row)
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative h-[62vh] min-h-[380px] shrink-0 overflow-hidden lg:h-auto lg:min-h-[420px] lg:flex-1 lg:shrink">
                  <GraphCanvas
                    nodes={model.nodes}
                    edges={model.edges}
                    focusPadding={wide ? PANEL_FOCUS_PADDING : BUBBLE_FOCUS_PADDING}
                    controlsPosition="top-left"
                    legend="none"
                    nodeMeta={nodeMeta}
                    selectedNodeId={shownId}
                    selectedEdgeId={selectedEdge?.id ?? null}
                    annotations={[]}
                    onSelectNode={(n) => selectNode(n.id)}
                    onSelectEdge={(edge) => setSelectedEdge(edge)}
                    onClearSelection={clearSelection}
                  />
                  {!wide && detail}
                </div>

                {/* A footer lane under the map holds the hint, clear of the nodes and zoom controls. */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-[var(--border-subtle)] py-2.5 pl-4 pr-2.5 sm:pl-5">
                  <p className="flex min-w-[12rem] flex-1 items-center gap-1.5 text-[12px] leading-snug text-[var(--text-secondary)]">
                    <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-[var(--status-gap)]" aria-hidden />
                    <span>Click a paper to see its claims and links · click a line to see why</span>
                  </p>
                </div>
              </section>

              <aside
                aria-label="Details and papers"
                className="apple-sheet flex h-[64vh] min-h-0 min-w-0 flex-col overflow-hidden rounded-[26px] lg:h-auto"
              >
                {wide && (
                  // The details take what they need; the list below keeps at least ~40% of the panel.
                  <div className="flex min-h-0 shrink flex-col border-b border-[var(--border-subtle)]">
                    {detail ?? <QuestionDetails title={dataset.title} />}
                  </div>
                )}
                <div className={`flex flex-1 basis-0 flex-col ${wide ? "min-h-[40%]" : "min-h-0"}`}>
                  <PaperList model={model} selectedId={selectedId} onSelect={selectNode} />
                </div>
              </aside>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
