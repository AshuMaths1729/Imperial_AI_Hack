"use client";

import React, { useCallback, useMemo, useState } from "react";
import { ReactFlowProvider, useReactFlow, useStoreApi } from "@xyflow/react";
import type { ConceptKind } from "../../types/scholartwin";
import type { PaperSimTabProps } from "./types";
import { ConceptCanvas, motionMs } from "./concepts/ConceptCanvas";
import { ConceptDetails } from "./concepts/ConceptDetails";
import type { NodeEmphasis } from "./concepts/ConceptNode";
import type { EmphasisState } from "./concepts/RelationEdge";
import { layoutGraph } from "./concepts/layout";
import { buildConceptGraph, pathFromRoot, type CLink } from "./concepts/model";

/** Small stable hash so the canvas re-mounts (re-layout + fit view) only on structural change. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** "Concept & Parameter Graph" tab: a layered, explorable map of the paper's ideas and knobs. */
export function ConceptGraphTab(props: PaperSimTabProps) {
  return (
    <ReactFlowProvider>
      <ConceptGraphWorkspace {...props} />
    </ReactFlowProvider>
  );
}

function ConceptGraphWorkspace({ simulation: sim, paramValues, annotations }: PaperSimTabProps) {
  const { setCenter } = useReactFlow();
  const store = useStoreApi();
  const graph = useMemo(() => buildConceptGraph(sim), [sim]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const layoutKey = useMemo(
    () =>
      hash(
        graph.nodes.map((n) => `${n.id}:${n.kind}:${n.label}`).join("|") +
          "#" +
          graph.links.map((l) => `${l.source}>${l.target}:${l.relation}`).join("|")
      ),
    [graph]
  );

  const [selectedRaw, setSelectedRaw] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [query, setQuery] = useState("");
  const [spotlight, setSpotlight] = useState<Set<ConceptKind>>(() => new Set());

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  // Derived: falls back to the root if the selection vanished after a data change.
  const selectedId = selectedRaw && nodeById.has(selectedRaw) ? selectedRaw : graph.rootId;
  const selected = nodeById.get(selectedId) ?? graph.nodes[0];

  const path = useMemo(() => pathFromRoot(graph, selectedId), [graph, selectedId]);

  const neighbours = useCallback(
    (id: string) => {
      const ids = new Set<string>([id]);
      for (const l of graph.links) {
        if (l.source === id) ids.add(l.target);
        if (l.target === id) ids.add(l.source);
      }
      return ids;
    },
    [graph.links]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes.filter((n) =>
      [n.label, n.summary, n.paramKey ?? "", n.kind.replace("_", " ")].some((t) => t.toLowerCase().includes(q))
    );
  }, [graph.nodes, query]);

  const pulsedIds = useMemo(
    () =>
      new Set(
        annotations.filter((a) => a.type === "pulse_node" && a.target_id).map((a) => a.target_id as string)
      ),
    [annotations]
  );

  const { nodeEmphasis, edgeEmphasis } = useMemo(() => {
    const nodeEmphasis = new Map<string, NodeEmphasis>();
    const edgeEmphasis = new Map<string, EmphasisState>();
    const q = query.trim();
    let focus: Set<string> | null = null;
    let activeEdges = new Set<string>();

    if (q) {
      focus = new Set(matches.map((n) => n.id));
    } else if (spotlight.size > 0) {
      focus = new Set(graph.nodes.filter((n) => spotlight.has(n.kind)).map((n) => n.id));
    } else if (tracing && path.length > 1) {
      focus = new Set(path);
      const pairs = new Set(path.slice(1).map((id, i) => [path[i], id].sort().join("\u0000")));
      activeEdges = new Set(
        graph.links.filter((l) => pairs.has([l.source, l.target].sort().join("\u0000"))).map((l) => l.id)
      );
    } else {
      activeEdges = new Set(
        graph.links.filter((l) => l.source === selectedId || l.target === selectedId).map((l) => l.id)
      );
      // The root's neighbourhood is "everything near the top": don't dim the map on first view.
      if (selectedId !== graph.rootId) focus = neighbours(selectedId);
    }
    focus?.add(selectedId);

    for (const n of graph.nodes) {
      nodeEmphasis.set(
        n.id,
        n.id === selectedId ? "selected" : !focus ? "normal" : focus.has(n.id) ? "focus" : "dim"
      );
    }
    for (const l of graph.links) {
      const inFocus = !focus || (focus.has(l.source) && focus.has(l.target));
      edgeEmphasis.set(l.id, activeEdges.has(l.id) ? "active" : inFocus ? "normal" : "dim");
    }
    return { nodeEmphasis, edgeEmphasis };
  }, [graph, query, matches, spotlight, tracing, path, selectedId, neighbours]);

  /**
   * Animate the camera onto `ids`. Shows them all when that is possible at a readable zoom;
   * otherwise zooms in on `primary` (the clicked node) so a click always zooms in.
   */
  const focusOn = useCallback(
    (ids: string[], primary: string, minZoom = 0.9): boolean => {
      const { width, height } = store.getState();
      const boxes = ids.map((id) => layout.nodes[id]).filter(Boolean);
      const main = layout.nodes[primary];
      if (!boxes.length || !main || !width || !height) return false;
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      const fit = Math.min(width / ((x1 - x0) * 1.25 + 80), height / ((y1 - y0) * 1.25 + 80));
      const all = fit >= minZoom;
      const zoom = Math.min(1.3, all ? fit : Math.max(minZoom, 1));
      const cx = all ? (x0 + x1) / 2 : main.x + main.w / 2;
      const cy = all ? (y0 + y1) / 2 : main.y + main.h / 2;
      void setCenter(cx, cy, { zoom, duration: motionMs(560) });
      return true;
    },
    [layout, setCenter, store]
  );

  const select = useCallback(
    (id: string) => {
      setSelectedRaw(id);
      setTracing(false);
      setSpotlight(new Set());
      focusOn(Array.from(neighbours(id)), id);
    },
    [focusOn, neighbours]
  );

  const toggleTrace = useCallback(() => {
    const next = !tracing;
    setTracing(next);
    if (next) {
      setQuery("");
      setSpotlight(new Set());
      focusOn(path, selectedId, 0.45);
    }
  }, [focusOn, path, selectedId, tracing]);

  // Open on the paper and its first connections at a readable zoom ("Whole map" shows all).
  const intro = useCallback(() => {
    // Retry briefly until React Flow has measured the pane (width/height are 0 before that).
    // setTimeout, not requestAnimationFrame: rAF never fires while the tab is in the background.
    let tries = 0;
    const attempt = () => {
      if (focusOn(Array.from(neighbours(graph.rootId)), graph.rootId, 0.6) || ++tries > 20) return;
      window.setTimeout(attempt, 50);
    };
    attempt();
  }, [focusOn, neighbours, graph.rootId]);

  const activateLink = useCallback(
    (l: CLink) => select(l.source === selectedId ? l.target : l.target === selectedId ? l.source : l.target),
    [select, selectedId]
  );

  const toggleKind = useCallback((k: ConceptKind) => {
    setSpotlight((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  return (
    // Two floating glass sheets with ~10px gutters. Stacked (< lg) the page scrolls; at lg the
    // details sheet scrolls itself. (The Live Tutor button sits in its own lane below the tab.)
    <div className="grid min-h-full grid-cols-1 content-start gap-2.5 px-2 pb-2 pt-2.5 sm:px-3 lg:h-full lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[minmax(0,1fr)] lg:pb-1">
      <div className="relative h-[62vh] min-h-[440px] min-w-0 lg:h-full lg:min-h-0">
        <ConceptCanvas
          key={layoutKey}
          graph={graph}
          layout={layout}
          nodeEmphasis={nodeEmphasis}
          edgeEmphasis={edgeEmphasis}
          paramValues={paramValues}
          pulsedIds={pulsedIds}
          query={query}
          onQueryChange={setQuery}
          matches={matches}
          spotlight={spotlight}
          onToggleKind={toggleKind}
          onSelect={select}
          onActivateLink={activateLink}
          onReady={intro}
        />
        {!graph.fromDocs && (
          <p className="apple-glass-elevated pointer-events-none absolute right-3 top-14 z-10 hidden max-w-[220px] rounded-2xl border px-3 py-1.5 text-right text-[10.5px] leading-snug text-[var(--text-muted)] sm:block">
            Built from the simulation spec — re-run the extraction for page references.
          </p>
        )}
      </div>
      <aside
        aria-label="Concept details"
        className="apple-sheet min-h-0 min-w-0 rounded-[22px] lg:overflow-y-auto"
      >
        {selected && (
          <ConceptDetails
            key={selected.id}
            graph={graph}
            node={selected}
            simulation={sim}
            paramValues={paramValues}
            path={path}
            tracing={tracing}
            onToggleTrace={toggleTrace}
            onSelect={select}
          />
        )}
      </aside>
    </div>
  );
}
