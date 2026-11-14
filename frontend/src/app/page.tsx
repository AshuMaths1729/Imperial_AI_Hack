"use client";

import React, { useEffect, useState, useCallback } from "react";
import { PenTool, Layers, Activity, GitCompare, Sparkles } from "lucide-react";
import {
  GraphNodeData,
  SpatialAskResponse,
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadMode = useCallback(async (targetMode: WorkspaceMode) => {
    setAnnotations([]);
    setLastBbox(null);
    setLassoActive(false);
    try {
      const res = await fetch(`${API_BASE}/api/demo/${targetMode}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WorkspaceDataset = await res.json();
      setDataset(data);
      setSelectedNode(data.nodes[0] ?? null);
      if (data.simulation) {
        const defaults: Record<string, number> = {};
        data.simulation.params.forEach((p) => (defaults[p.key] = p.default_val));
        setParamValues(defaults);
      }
      setStatusMsg(null);
    } catch {
      setStatusMsg("Backend offline — start FastAPI on :8000 to load live datasets.");
    }
  }, []);

  useEffect(() => {
    loadMode(mode);
  }, [mode, loadMode]);

  const speakText = (text: string) => {
    if (!ttsEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => {
      setIsSpeaking(false);
      setAvatarState("idle");
    };
    window.speechSynthesis.speak(utter);
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

    try {
      const res = await fetch(`${API_BASE}/api/ask-spatial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          transcript,
          bbox: activeBox,
          hit_node_ids: hitNodeIds,
          sim_params: paramValues,
        }),
      });
      if (!res.ok) throw new Error("Ask failed");
      const data: SpatialAskResponse = await res.json();
      setLastReply(data.spoken_answer);
      setAvatarState(data.avatar_state);
      setAnnotations(data.annotations);
      if (data.suggested_quiz_node_id && dataset) {
        const target = dataset.nodes.find((n) => n.id === data.suggested_quiz_node_id);
        if (target) setSelectedNode(target);
      }
      speakText(data.spoken_answer);
    } catch {
      setLastReply("Could not reach /api/ask-spatial. Make sure FastAPI is running on port 8000.");
    }
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
            onClick={() => setMode("lecture")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "lecture" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            LectureGraph
          </button>
          <button
            onClick={() => setMode("paper2sim")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "paper2sim" ? "bg-sky-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Paper2Sim
          </button>
          <button
            onClick={() => setMode("hypothesis")}
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
          onToggleTts={() => setTtsEnabled((v) => !v)}
          onAsk={(text) => handleAsk(text)}
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
