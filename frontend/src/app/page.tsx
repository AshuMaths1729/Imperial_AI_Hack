"use client";

import React, { useEffect, useRef, useState } from "react";
import { PenTool, Layers, Activity, GitCompare, Sparkles, GraduationCap } from "lucide-react";
import type { AskSpatialRequest, AskSpatialResponse } from "../api/types";
import {
  GraphNodeData,
  UIAnnotation,
  WorkspaceDataset,
  WorkspaceMode,
} from "../types/scholartwin";
import { AvatarDock } from "../components/AvatarDock";
import { GraphCanvas } from "../components/GraphCanvas";
import { PaperSimCanvas } from "../components/PaperSimCanvas";
import { InspectorPane } from "../components/InspectorPane";
import { BoundingBox, LassoOverlay } from "../components/LassoOverlay";
import { UploadModal } from "../components/UploadModal";
import { LiveAvatarTile } from "../tutor/LiveAvatarTile";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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

export default function ScholarTwinWorkspace() {
  const [mode, setMode] = useState<WorkspaceMode>("lecture");
  const [dataset, setDataset] = useState<WorkspaceDataset | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [lassoActive, setLassoActive] = useState(false);
  const [lastBbox, setLastBbox] = useState<BoundingBox | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [annotations, setAnnotations] = useState<UIAnnotation[]>([]);
  const [avatarState, setAvatarState] = useState<"idle" | "listening" | "explaining" | "emphatic" | "questioning">("idle");
  const [lastReply, setLastReply] = useState(
    "Hi! I'm ScholarTwin. Switch modes above, or toggle Circle-to-Ask to circle any node or curve and ask me about it."
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const switchMode = (next: WorkspaceMode) => {
    if (next === mode) return;
    setAnnotations([]);
    setLastBbox(null);
    setLassoActive(false);
    setMode(next);
  };

  useEffect(() => {
    // Ignore a stale response if the mode changed (or the component unmounted) mid-request.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/demo/${mode}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: WorkspaceDataset = await res.json();
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
        // The Phase-1 demo datasets were removed in Phase 2, so this load fails even when the
        // backend is up. Only claim "offline" if the health check fails too.
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
  }, [mode]);

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
        body: JSON.stringify({ text: text.slice(0, 1000) }),
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
    try {
      const res = await fetch(`${API_BASE}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) return;
      const simRes = await res.json();
      setDataset((prev) =>
        prev && prev.simulation
          ? { ...prev, simulation: { ...prev.simulation, x: simRes.x, series: simRes.series } }
          : prev
      );
    } catch {
      // ignore transient errors during slider drag
    }
  };

  const handleAsk = async (transcript: string, bboxOverride?: BoundingBox) => {
    const activeBox = bboxOverride ?? lastBbox;
    const hitNodeIds = selectedNode ? [selectedNode.id] : [];

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

  const applyIngestedDataset = (data: WorkspaceDataset) => {
    setDataset(data);
    setSelectedNode(data.nodes[0] ?? null);
    setAnnotations([]);
    setUploadOpen(false);
    setUploadError(null);
    const msg = `Loaded "${data.title}" with ${data.nodes.length || "live simulation"} items. Click or circle any part to ask me about it!`;
    setLastReply(msg);
    speakText(msg);
  };

  const handleUploadPdf = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      const res = await fetch(`${API_BASE}/api/ingest/pdf`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data: WorkspaceDataset = await res.json();
      applyIngestedDataset(data);
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
      const res = await fetch(`${API_BASE}/api/ingest/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode }),
      });
      if (!res.ok) throw new Error(`URL ingest failed (${res.status})`);
      const data: WorkspaceDataset = await res.json();
      applyIngestedDataset(data);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not fetch URL. Is the backend running?");
    } finally {
      setUploadLoading(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Workspace Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100">ScholarTwin</h1>
            <p className="text-[11px] text-slate-400">Spatial AI Research & Learning Workspace</p>
          </div>
        </div>

        {/* Mode Switcher */}
        <nav className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
          <button
            onClick={() => switchMode("lecture")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "lecture" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            LectureGraph
          </button>
          <button
            onClick={() => switchMode("paper2sim")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "paper2sim" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Paper2Sim
          </button>
          <button
            onClick={() => switchMode("hypothesis")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "hypothesis" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <GitCompare className="h-3.5 w-3.5" />
            HypothesisGraph
          </button>
        </nav>

        {/* Circle-to-Ask Toggle */}
        <div className="flex items-center gap-2">
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

      {/* Main 3-Pane Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[290px_1fr_320px]">
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
          avatar={<LiveAvatarTile />}
          onUploadClick={() => {
            setUploadError(null);
            setUploadOpen(true);
          }}
        />

        {/* Center Pane: Interactive Graphic + Circle-to-Ask Overlay */}
        <main className="relative flex min-h-0 flex-col bg-slate-950">
          {dataset && (
            <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/40 px-4 py-2">
              <div>
                <h2 className="text-xs font-semibold text-slate-100">{dataset.title}</h2>
                <p className="text-[11px] text-slate-400">{dataset.subtitle}</p>
              </div>
              {mode !== "paper2sim" && (
                <div className="hidden items-center gap-3 text-[10px] text-slate-400 sm:flex">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" />Prereq</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />Supports</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />Contradicts</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" />Gap</span>
                </div>
              )}
            </div>
          )}

          {statusMsg && (
            <div className="m-4 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
              {statusMsg}
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {dataset && mode !== "paper2sim" && (
              <GraphCanvas
                nodes={dataset.nodes}
                edges={dataset.edges}
                selectedNodeId={selectedNode?.id ?? null}
                annotations={annotations}
                onSelectNode={(n) => setSelectedNode(n)}
              />
            )}

            {dataset && mode === "paper2sim" && dataset.simulation && (
              <PaperSimCanvas
                simulation={dataset.simulation}
                paramValues={paramValues}
                annotations={annotations}
                onParamChange={handleParamChange}
              />
            )}

            <LassoOverlay active={lassoActive} onCapture={handleLassoCapture} />
          </div>
        </main>

        {/* Right Pane: Context Inspector */}
        <InspectorPane
          mode={mode}
          selectedNode={selectedNode}
          edges={dataset?.edges ?? []}
          simulation={dataset?.simulation}
        />
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
