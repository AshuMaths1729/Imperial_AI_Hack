"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { SimSpec } from "../api/types";
import { generateSim, runSim } from "../api/endpoints";
import { fixtureGetSim } from "../api/fixtures";
import { resolveSimId, simOutputToSeries, simSpecToWorkspaceDataset } from "../api/adapters";
import { ApiError } from "../api/client";
import { UIAnnotation, WorkspaceDataset, WorkspaceMode } from "../types/scholartwin";
import { UploadModal } from "../components/UploadModal";
import { LibraryTopic, LibraryView } from "../components/LibraryView";
import { HomeHub } from "../components/HomeHub";
import { PaperSimTabsView } from "../components/PaperSimTabsView";
import { HypothesisChatView } from "../components/HypothesisChatView";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const LIBRARY_STORAGE_KEY = "scholartwin.library.v1";
/** LectureUnderstanding is the live lesson (tutor, slides, whiteboard) on its own route. */
const LECTURE_ROUTE = "/lecture/lesson";

const DEFAULT_LIBRARY_TOPICS: LibraryTopic[] = [
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
];

/** The PaperSim workspace no longer receives tutor annotations; one stable empty list. */
const NO_ANNOTATIONS: UIAnnotation[] = [];

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

type Screen = "home" | "library" | "papersim-workspace" | "hypothesis-chat";

export default function AthenaWorkspace() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("home");
  const libraryTopics = useSyncExternalStore(
    subscribeLibrary,
    getLibrarySnapshot,
    getServerLibrarySnapshot
  );
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [dataset, setDataset] = useState<WorkspaceDataset | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
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
    setUploadOpen(false);
    setUploadError(null);
    if (selected === "lecture") router.push(LECTURE_ROUTE);
    else if (selected === "hypothesis") setScreen("hypothesis-chat");
    else setScreen("library");
  };

  const openTopic = (topic: LibraryTopic) => {
    setActiveTopicId(topic.id);
    if (topic.dataset) {
      skipNextFetchRef.current = true;
      setDataset(topic.dataset);
      if (topic.dataset.simulation) {
        const defaults: Record<string, number> = {};
        topic.dataset.simulation.params.forEach((p) => (defaults[p.key] = p.default_val));
        setParamValues(defaults);
      }
      setStatusMsg(null);
    } else {
      setDataset(null);
    }
    setScreen("papersim-workspace");
  };

  const deleteTopic = (id: string) => {
    persistLibrary(libraryTopics.filter((t) => t.id !== id));
    if (activeTopicId === id) setActiveTopicId(null);
  };

  useEffect(() => {
    if (screen !== "papersim-workspace") return;
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
    // Ignore a stale response if the screen changed (or the component unmounted) mid-request.
    let cancelled = false;
    (async () => {
      try {
        const data = simSpecToWorkspaceDataset(await fixtureGetSim("sim_heavy_ball"));
        if (cancelled) return;
        setDataset(data);
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
            ? "Backend connected. No simulation loaded yet; load a paper to generate one."
            : "Backend offline — start FastAPI on :8000 to load live datasets."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen]);

  const simRunSeqRef = useRef(0);

  /** Set several slider values at once (presets, reset) and re-run the simulation. */
  const handleSetParams = async (next: Record<string, number>) => {
    setParamValues(next);
    const sim = dataset?.simulation;
    if (!sim) return;
    const seq = ++simRunSeqRef.current;
    const simId = await resolveSimId(sim);
    if (!simId) {
      setStatusMsg("This saved simulation can't be re-run. Load the paper again to regenerate it.");
      return;
    }
    try {
      const simRes = await runSim(simId, next);
      if (seq !== simRunSeqRef.current) return; // a newer run superseded this one
      const { x, series } = simOutputToSeries(simRes.output);
      setStatusMsg(null);
      setDataset((prev) =>
        prev && prev.simulation
          ? { ...prev, simulation: { ...prev.simulation, sim_id: simId, x, series } }
          : prev
      );
    } catch (err) {
      // Transient errors during a slider drag are ignored; a missing simulation is not.
      if (seq === simRunSeqRef.current && err instanceof ApiError && err.status === 404) {
        setStatusMsg("This saved simulation is no longer on the server. Load the paper again to regenerate it.");
      }
    }
  };

  const handleParamChange = (key: string, val: number) =>
    handleSetParams({ ...paramValues, [key]: val });

  const applyIngestedDataset = (
    data: WorkspaceDataset,
    sourceLabel: string,
    sourceType: "pdf" | "url"
  ) => {
    skipNextFetchRef.current = true;
    setDataset(data);
    if (data.simulation) {
      const defaults: Record<string, number> = {};
      data.simulation.params.forEach((p) => (defaults[p.key] = p.default_val));
      setParamValues(defaults);
    }
    setUploadOpen(false);
    setUploadError(null);
    setStatusMsg(null);
    const newTopic: LibraryTopic = {
      id: `topic-${Date.now()}`,
      title: data.title,
      subtitle: data.subtitle,
      mode: "paper2sim",
      sourceLabel,
      sourceType,
      updatedAt: new Date().toISOString(),
      lastReply: `Loaded "${data.title}" as a live simulation.`,
      dataset: data,
    };
    setActiveTopicId(newTopic.id);
    persistLibrary([newTopic, ...libraryTopics]);
    setScreen("papersim-workspace");
  };

  const handleUploadPdf = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/sim/generate-pdf`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Simulation generation failed (${res.status})`);
      const spec: SimSpec = await res.json();
      applyIngestedDataset(simSpecToWorkspaceDataset(spec, file.name), file.name, "pdf");
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
      const arxivMatch = url.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/);
      const spec = await generateSim(arxivMatch ? { arxiv_id: arxivMatch[1] } : { paper_text: url });
      applyIngestedDataset(simSpecToWorkspaceDataset(spec, url), url, "url");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Could not fetch URL. Is the backend running?");
    } finally {
      setUploadLoading(false);
    }
  };

  if (screen === "hypothesis-chat") {
    return <HypothesisChatView onBackHome={() => setScreen("home")} />;
  }

  if (screen === "library") {
    return (
      <LibraryView
        mode="paper2sim"
        topics={libraryTopics.filter((t) => t.mode === "paper2sim")}
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
          annotations={NO_ANNOTATIONS}
          statusMsg={statusMsg}
          onParamChange={handleParamChange}
          onSetParams={handleSetParams}
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

  return <HomeHub onSelectMode={handleSelectHomeMode} />;
}
