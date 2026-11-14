"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  PenTool,
  Sparkles,
  GraduationCap,
  BookOpen,
  MessageSquarePlus,
} from "lucide-react";
import type { AskSpatialRequest, AskSpatialResponse, SimSpec } from "../api/types";
import {
  createTopicGraph,
  generateSim,
  ingestLecture,
  ingestPaper,
  runSim,
} from "../api/endpoints";
import { fixtureGetGraph, fixtureGetSim } from "../api/fixtures";
import {
  graphToWorkspaceDataset,
  simOutputToSeries,
  simSpecToWorkspaceDataset,
} from "../api/adapters";
import {
  GraphNodeData,
  UIAnnotation,
  WorkspaceDataset,
  WorkspaceMode,
} from "../types/scholartwin";
import { AvatarDock } from "../components/AvatarDock";
import { GraphCanvas } from "../components/GraphCanvas";
import { BoundingBox, LassoOverlay } from "../components/LassoOverlay";
import { UploadModal } from "../components/UploadModal";
import { LibraryTopic, LibraryView } from "../components/LibraryView";
import { HomeHub } from "../components/HomeHub";
import { PaperSimTabsView } from "../components/PaperSimTabsView";
import { HypothesisChatView } from "../components/HypothesisChatView";
import { LiveAvatarTile } from "../tutor/LiveAvatarTile";
import { useAvatarCall } from "../tutor/useAvatarCall";
import type { Tutor } from "../tutor/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const LIBRARY_STORAGE_KEY = "scholartwin.library.v1";

const DEFAULT_LIBRARY_TOPICS: LibraryTopic[] = [
  {
    id: "seed-lecture-attention",
    title: "Attention Is All You Need",
    subtitle: "Scaled dot-product attention, multi-head projections & positional encodings",
    mode: "lecture",
    sourceLabel: "LectureGraph Preset",
    sourceType: "preset",
    updatedAt: "2026-11-14T17:20:00Z",
    lastReply: "Explored how Q·Kᵀ scaling prevents softmax saturation in deep layers.",
  },
  {
    id: "seed-sim-heavy-ball",
    title: "Heavy-Ball Momentum Dynamics",
    subtitle: "Interactive ODE parameter sweep for step size and momentum β",
    mode: "paper2sim",
    sourceLabel: "Paper2Sim Preset",
    sourceType: "preset",
    updatedAt: "2026-11-14T16:00:00Z",
    lastReply: "Compared under-damped oscillations at β = 0.9 vs critical damping.",
  },
  {
    id: "seed-hyp-scaling",
    title: "Compute-Optimal Scaling Laws",
    subtitle: "Supporting & contradicting claims across Kaplan vs. Chinchilla",
    mode: "hypothesis",
    sourceLabel: "HypothesisGraph Preset",
    sourceType: "preset",
    updatedAt: "2026-11-14T12:00:00Z",
    lastReply: "Highlighted token-to-parameter ratio gap in small-budget regimes.",
  },
];

let cachedLibraryRaw: string | null = null;
let cachedLibraryTopics: LibraryTopic[] = DEFAULT_LIBRARY_TOPICS;
const libraryListeners = new Set<() => void>();

function subscribeLibrary(cb: () => void) {
  libraryListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LIBRARY_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    libraryListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getLibrarySnapshot(): LibraryTopic[] {
  if (typeof window === "undefined") return DEFAULT_LIBRARY_TOPICS;
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return DEFAULT_LIBRARY_TOPICS;
    if (raw === cachedLibraryRaw) return cachedLibraryTopics;
    const parsed = JSON.parse(raw) as LibraryTopic[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      cachedLibraryRaw = raw;
      cachedLibraryTopics = parsed;
      return cachedLibraryTopics;
    }
  } catch {
    // ignore malformed localStorage
  }
  return DEFAULT_LIBRARY_TOPICS;
}

function getServerLibrarySnapshot(): LibraryTopic[] {
  return DEFAULT_LIBRARY_TOPICS;
}

const MODE_TO_VIEW: Record<WorkspaceMode, AskSpatialRequest["active_context"]["view"]> = {
  lecture: "lecture",
  paper2sim: "sim",
  hypothesis: "hypothesis",
};

/** Map v2 segment annotations onto the Phase-1 overlay's shape (it draws only these three types). */
function toLegacyAnnotations(data: AskSpatialResponse): UIAnnotation[] {
  const out: UIAnnotation[] = [];
  for (const seg of data.segments) {
    for (const a of seg.ui_annotations) {
      if (a.type === "pulse_node" || a.type === "highlight_edge") {
        out.push({ type: a.type, target_id: a.id, label: a.label ?? "" });
      } else if (a.type === "callout_box") {
        out.push({
          type: "callout_box",
          target_id: a.target_id ?? undefined,
          x: a.x ?? undefined,
          y: a.y ?? undefined,
          label: a.label,
        });
      }
    }
  }
  return out;
}

type Screen =
  | "home"
  | "library"
  | "lecture-workspace"
  | "papersim-workspace"
  | "hypothesis-chat";

export default function ScholarTwinWorkspace() {
  const [screen, setScreen] = useState<Screen>("home");
  const libraryTopics = useSyncExternalStore(
    subscribeLibrary,
    getLibrarySnapshot,
    getServerLibrarySnapshot
  );
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>("lecture");
  const [dataset, setDataset] = useState<WorkspaceDataset | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [lassoActive, setLassoActive] = useState(false);
  const [lastBbox, setLastBbox] = useState<BoundingBox | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [annotations, setAnnotations] = useState<UIAnnotation[]>([]);
  const [avatarState, setAvatarState] = useState<"idle" | "listening" | "explaining" | "emphatic" | "questioning">("idle");
  const [lastReply, setLastReply] = useState(
    "Hi! I'm ScholarTwin. Toggle Circle-to-Ask to circle any concept node and ask me about it."
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const call = useAvatarCall();
  const [tutor, setTutor] = useState<Tutor | undefined>();
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const skipNextFetchRef = useRef(false);

  const persistLibrary = (next: LibraryTopic[]) => {
    try {
      const serialized = JSON.stringify(next);
      cachedLibraryRaw = serialized;
      cachedLibraryTopics = next;
      localStorage.setItem(LIBRARY_STORAGE_KEY, serialized);
      libraryListeners.forEach((cb) => cb());
    } catch {
      // ignore storage quota errors
    }
  };

  const handleSelectHomeMode = (selected: WorkspaceMode) => {
    setMode(selected);
    setUploadOpen(false);
    setUploadError(null);
    if (selected === "hypothesis") {
      setScreen("hypothesis-chat");
    } else {
      setScreen("library");
    }
  };

  const openTopic = (topic: LibraryTopic) => {
    setAnnotations([]);
    setLastBbox(null);
    setLassoActive(false);
    setActiveTopicId(topic.id);
    setLastReply(topic.lastReply);
    if (topic.dataset) {
      skipNextFetchRef.current = true;
      setDataset(topic.dataset);
      setSelectedNode(topic.dataset.nodes[0] ?? null);
      if (topic.dataset.simulation) {
        const defaults: Record<string, number> = {};
        topic.dataset.simulation.params.forEach((p) => (defaults[p.key] = p.default_val));
        setParamValues(defaults);
      }
      setStatusMsg(null);
    } else {
      setDataset(null);
      setSelectedNode(null);
    }
    setMode(topic.mode);
    setScreen(topic.mode === "paper2sim" ? "papersim-workspace" : "lecture-workspace");
  };

  const deleteTopic = (id: string) => {
    persistLibrary(libraryTopics.filter((t) => t.id !== id));
    if (activeTopicId === id) setActiveTopicId(null);
  };

  useEffect(() => {
    if (screen !== "lecture-workspace" && screen !== "papersim-workspace") return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    // Ignore a stale response if the mode changed (or the component unmounted) mid-request.
    let cancelled = false;
    (async () => {
      try {
        let data: WorkspaceDataset;
        if (mode === "paper2sim") {
          const spec = await fixtureGetSim("sim_heavy_ball");
          data = simSpecToWorkspaceDataset(spec);
        } else {
          const graph = await fixtureGetGraph(mode === "hypothesis" ? "hypothesis" : "lecture");
          data = graphToWorkspaceDataset(graph, mode);
        }
        if (cancelled) return;
        setDataset(data);
        setSelectedNode(data.nodes[0] ?? null);
        if (data.simulation) {
          const defaults: Record<string, number> = {};
          data.simulation.params.forEach((p) => (defaults[p.key] = p.default_val));
          setParamValues(defaults);
        }
        setStatusMsg(null);
      } catch {
        const online = await fetch(`${API_BASE}/api/health`)
          .then((r) => r.ok)
          .catch(() => false);
        if (cancelled) return;
        setStatusMsg(
          online
            ? "Backend connected. No dataset loaded yet; you can still ask the tutor a question."
            : "Backend offline — start FastAPI on :8000 to load live datasets."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, screen]);

  const speakWithBrowser = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setAvatarState("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = utter.onerror = () => {
      setIsSpeaking(false);
      setAvatarState("idle");
    };
    window.speechSynthesis.speak(utter);
  };

  const stopSpeaking = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  // ElevenLabs voice via the backend's /api/tts; the browser's own voice is only a fallback.
  const speakText = async (text: string) => {
    if (!ttsEnabled) return;
    stopSpeaking();
    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The on-screen tutor's own ElevenLabs voice (the backend default if none is picked).
        body: JSON.stringify({ text: text.slice(0, 1000), voice_id: tutor?.voice_id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      const audio = new Audio(/^https?:/.test(url) ? url : `${API_BASE}${url}`);
      audioRef.current = audio;
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        setAvatarState("idle");
      };
      await audio.play();
    } catch (err) {
      console.warn("ElevenLabs TTS failed; using the browser voice", err);
      speakWithBrowser(text);
    }
  };

  const handleParamChange = async (key: string, val: number) => {
    const next = { ...paramValues, [key]: val };
    setParamValues(next);
    const simId = dataset?.simulation?.arxiv_id;
    if (!simId) return;
    try {
      const simRes = await runSim(simId, next);
      const { x, series } = simOutputToSeries(simRes.output);
      setDataset((prev) =>
        prev && prev.simulation
          ? { ...prev, simulation: { ...prev.simulation, x, series } }
          : prev
      );
    } catch {
      // ignore transient errors during slider drag
    }
  };

  const handleAsk = async (transcript: string, bboxOverride?: BoundingBox) => {
    const activeBox = bboxOverride ?? lastBbox;
    const hitNodeIds = selectedNode ? [selectedNode.id] : [];

    // In a live call, ask the live tutor: they answer in their own voice with a lip-synced face.
    if (call.status === "live") {
      stopSpeaking();
      call.sendText(transcript);
      setLastReply(`Asked ${tutor?.name ?? "your tutor"} in the live call. Their answer appears as a caption.`);
      return;
    }

    const req: AskSpatialRequest = {
      transcript,
      hit_metadata: {
        node_ids: hitNodeIds,
        edge_ids: [],
        bbox: activeBox ? [activeBox.x, activeBox.y, activeBox.w, activeBox.h] : null,
      },
      active_context: {
        view: MODE_TO_VIEW[mode],
        params: mode === "paper2sim" && Object.keys(paramValues).length ? paramValues : null,
      },
    };

    setLastReply("Thinking...");
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/ask-spatial/v2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
    } catch {
      setLastReply("Could not reach the backend. Make sure FastAPI is running on port 8000.");
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = body?.error?.message ?? body?.detail ?? res.statusText;
      setLastReply(`The tutor couldn't answer (HTTP ${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
      return;
    }
    const data: AskSpatialResponse = await res.json();
    setLastReply(data.spoken_answer);
    setAvatarState(data.avatar_state ?? "explaining");
    setAnnotations(toLegacyAnnotations(data));
    if (data.follow_up?.node_id && dataset) {
      const target = dataset.nodes.find((n) => n.id === data.follow_up?.node_id);
      if (target) setSelectedNode(target);
    }
    speakText(data.spoken_answer);
  };

  const handleLassoCapture = (bbox: BoundingBox) => {
    setLastBbox(bbox);
    setLassoActive(false);
    handleAsk("Explain what I just circled here.", bbox);
  };

  const applyIngestedDataset = (
    data: WorkspaceDataset,
    sourceLabel: string,
    sourceType: "pdf" | "url"
  ) => {
    skipNextFetchRef.current = true;
    setDataset(data);
    setSelectedNode(data.nodes[0] ?? null);
    if (data.simulation) {
      const defaults: Record<string, number> = {};
      data.simulation.params.forEach((p) => (defaults[p.key] = p.default_val));
      setParamValues(defaults);
    }
    setAnnotations([]);
    setUploadOpen(false);
    setUploadError(null);
    setStatusMsg(null);
    const msg = `Loaded "${data.title}" with ${data.nodes.length || "live simulation"} items. Click or circle any part to ask me about it!`;
    setLastReply(msg);
    const newTopic: LibraryTopic = {
      id: `topic-${Date.now()}`,
      title: data.title,
      subtitle: data.subtitle,
      mode,
      sourceLabel,
      sourceType,
      updatedAt: new Date().toISOString(),
      lastReply: msg,
      dataset: data,
    };
    setActiveTopicId(newTopic.id);
    persistLibrary([newTopic, ...libraryTopics]);
    setScreen(mode === "paper2sim" ? "papersim-workspace" : "lecture-workspace");
    speakText(msg);
  };

  const handleUploadPdf = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    try {
      let data: WorkspaceDataset;
      if (mode === "lecture") {
        const res = await ingestLecture(file);
        data = graphToWorkspaceDataset(res.graph, "lecture", file.name);
      } else if (mode === "paper2sim") {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${API_BASE}/api/sim/generate-pdf`, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Simulation generation failed (${res.status})`);
        const spec: SimSpec = await res.json();
        data = simSpecToWorkspaceDataset(spec, file.name);
      } else {
        const paper = await ingestPaper({ file });
        const graph = await createTopicGraph(paper.title || file.name);
        data = graphToWorkspaceDataset(graph, "hypothesis", paper.title || file.name);
      }
      applyIngestedDataset(data, file.name, "pdf");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not parse PDF. Is the backend running?");
    } finally {
      setUploadLoading(false);
    }
  };

  const handleIngestUrl = async (url: string) => {
    setUploadLoading(true);
    setUploadError(null);
    try {
      let data: WorkspaceDataset;
      if (mode === "paper2sim") {
        const arxivMatch = url.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/);
        const spec = await generateSim(
          arxivMatch ? { arxiv_id: arxivMatch[1] } : { paper_text: url }
        );
        data = simSpecToWorkspaceDataset(spec, url);
      } else {
        const isUrl = /^https?:\/\//i.test(url);
        const isArxivId = /^\d{4}\.\d{4,5}(v\d+)?$/.test(url);
        let query = url;
        if (isUrl || isArxivId) {
          const paper = await ingestPaper(isArxivId ? { arxiv_id: url } : { url });
          query = paper.title || url;
        }
        const graph = await createTopicGraph(query);
        data = graphToWorkspaceDataset(graph, mode, query);
      }
      applyIngestedDataset(data, url, "url");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not fetch URL. Is the backend running?");
    } finally {
      setUploadLoading(false);
    }
  };

  if (screen === "home") {
    return <HomeHub onSelectMode={handleSelectHomeMode} />;
  }

  if (screen === "hypothesis-chat") {
    return <HypothesisChatView onBackHome={() => setScreen("home")} />;
  }

  if (screen === "library") {
    const libraryMode = mode === "paper2sim" ? "paper2sim" : "lecture";
    return (
      <LibraryView
        mode={libraryMode}
        topics={libraryTopics.filter((t) => t.mode === libraryMode)}
        uploadLoading={uploadLoading}
        uploadError={uploadError}
        onBackHome={() => setScreen("home")}
        onOpenTopic={openTopic}
        onDeleteTopic={deleteTopic}
        onUploadPdf={handleUploadPdf}
        onIngestUrl={handleIngestUrl}
      />
    );
  }

  if (screen === "papersim-workspace") {
    return (
      <>
        <PaperSimTabsView
          dataset={dataset}
          paramValues={paramValues}
          annotations={annotations}
          statusMsg={statusMsg}
          onParamChange={handleParamChange}
          onBackToLibrary={() => setScreen("library")}
          onNewConversation={() => {
            setUploadError(null);
            setUploadOpen(true);
          }}
        />
        <UploadModal
          open={uploadOpen}
          loading={uploadLoading}
          error={uploadError}
          onClose={() => setUploadOpen(false)}
          onUploadPdf={handleUploadPdf}
          onIngestUrl={handleIngestUrl}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Workspace Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setScreen("library")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-500/60 hover:text-sky-300"
          >
            <BookOpen className="h-3.5 w-3.5 text-sky-400" />
            Lecture Library
          </button>
          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-100">
                LectureUnderstanding
              </h1>
              <p className="text-[11px] text-slate-400">2-Pane Avatar & Concept Canvas</p>
            </div>
          </div>
        </div>

        {/* Circle-to-Ask & New Conversation */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUploadError(null);
              setUploadOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/25"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New Conversation
          </button>
          <button
            onClick={() => setLassoActive((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              lassoActive
                ? "border-sky-400 bg-sky-500/20 text-sky-300 shadow-sm shadow-sky-500/20"
                : "border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600"
            }`}
          >
            <PenTool className="h-3.5 w-3.5" />
            {lassoActive ? "Draw Circle on Canvas..." : "Circle-to-Ask"}
          </button>
          <a
            href="/tutor"
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Live Tutor
          </a>
          <span className="hidden rounded-md border border-emerald-800/70 bg-emerald-950/50 px-2.5 py-1 text-[11px] font-medium text-emerald-300 md:inline-block">
            Demo Preset Ready
          </span>
        </div>
      </header>

      {/* Main 2-Pane Workspace: Avatar & Canvas */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[310px_1fr]">
        {/* Left Pane: Avatar & Voice */}
        <AvatarDock
          avatarState={avatarState}
          lastReply={lastReply}
          isSpeaking={isSpeaking}
          ttsEnabled={ttsEnabled}
          onToggleTts={() => {
            if (ttsEnabled) stopSpeaking();
            setTtsEnabled((v) => !v);
          }}
          onAsk={(text) => handleAsk(text)}
          avatar={<LiveAvatarTile call={call} onTutorChange={setTutor} />}
          onUploadClick={() => {
            setUploadError(null);
            setUploadOpen(true);
          }}
        />

        {/* Right Pane: Interactive Concept Canvas + Circle-to-Ask Overlay */}
        <main className="relative flex min-h-0 flex-col bg-slate-950">
          {dataset && (
            <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/40 px-4 py-2">
              <div>
                <h2 className="text-xs font-semibold text-slate-100">{dataset.title}</h2>
                <p className="text-[11px] text-slate-400">{dataset.subtitle}</p>
              </div>
              <div className="hidden items-center gap-3 text-[10px] text-slate-400 sm:flex">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" />Prereq</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Supports</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />Contradicts</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" />Gap</span>
              </div>
            </div>
          )}

          {statusMsg && (
            <div className="m-4 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
              {statusMsg}
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {dataset && (
              <GraphCanvas
                nodes={dataset.nodes}
                edges={dataset.edges}
                selectedNodeId={selectedNode?.id ?? null}
                annotations={annotations}
                onSelectNode={(n) => setSelectedNode(n)}
              />
            )}

            <LassoOverlay active={lassoActive} onCapture={handleLassoCapture} />

            {selectedNode && (
              <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10 flex justify-center">
                <div className="pointer-events-auto max-w-xl rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5 shadow-xl backdrop-blur-md">
                  <p className="text-xs font-semibold text-sky-300">{selectedNode.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-300">
                    {selectedNode.summary}
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <UploadModal
        open={uploadOpen}
        loading={uploadLoading}
        error={uploadError}
        onClose={() => setUploadOpen(false)}
        onUploadPdf={handleUploadPdf}
        onIngestUrl={handleIngestUrl}
      />
    </div>
  );
}
