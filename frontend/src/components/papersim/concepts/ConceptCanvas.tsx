"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  useStoreApi,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowRight, Maximize2, Search, X } from "lucide-react";
import type { ConceptKind } from "../../../types/scholartwin";
import { RichText } from "../../math/MathTex";
import { ConceptNodeCard, type ConceptFlowNode, type NodeEmphasis } from "./ConceptNode";
import { KIND_META, KIND_ORDER, LINK_META, LINK_ORDER, mix } from "./kinds";
import type { GraphLayout } from "./layout";
import type { CLink, CNode, ConceptGraph, LinkKind } from "./model";
import {
  EdgeInteractionContext,
  RelationEdge,
  type EdgeInteraction,
  type EmphasisState,
  type RelationFlowEdge,
} from "./RelationEdge";

const nodeTypes: NodeTypes = { concept: ConceptNodeCard };
const edgeTypes: EdgeTypes = { relation: RelationEdge };
/**
 * Must be a stable object: React Flow copies `fitViewOptions` into its store whenever the prop
 * changes, which would overwrite the options of a queued `fitView()` call (click-to-zoom).
 */
const FIT_VIEW_OPTIONS = { padding: 0.12, maxZoom: 1.1 } as const;

export function motionMs(ms: number): number {
  if (typeof window === "undefined") return ms;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}

interface ConceptCanvasProps {
  graph: ConceptGraph;
  layout: GraphLayout;
  nodeEmphasis: Map<string, NodeEmphasis>;
  edgeEmphasis: Map<string, EmphasisState>;
  paramValues: Record<string, number>;
  pulsedIds: Set<string>;
  query: string;
  onQueryChange: (q: string) => void;
  matches: CNode[];
  spotlight: Set<ConceptKind>;
  onToggleKind: (k: ConceptKind) => void;
  onSelect: (id: string) => void;
  onActivateLink: (link: CLink) => void;
  /** Called once React Flow is ready (viewport + node sizes known). */
  onReady?: () => void;
}

export function ConceptCanvas({
  graph,
  layout,
  nodeEmphasis,
  edgeEmphasis,
  paramValues,
  pulsedIds,
  query,
  onQueryChange,
  matches,
  spotlight,
  onToggleKind,
  onSelect,
  onActivateLink,
  onReady,
}: ConceptCanvasProps) {
  const { setCenter } = useReactFlow();
  const store = useStoreApi();
  const wrapRef = useRef<HTMLDivElement>(null);

  /**
   * Zoom out to the whole map. Computed from the layout and applied with setCenter, because
   * React Flow 12 queues fitView() until the next nodes update, which a button click never causes.
   */
  const showWholeMap = useCallback(() => {
    const { width, height } = store.getState();
    const boxes = Object.values(layout.nodes);
    if (!boxes.length || !width || !height) return;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const pad = 1 + FIT_VIEW_OPTIONS.padding * 2;
    const zoom = Math.max(0.15, Math.min(FIT_VIEW_OPTIONS.maxZoom, width / ((x1 - x0) * pad), height / ((y1 - y0) * pad)));
    void setCenter((x0 + x1) / 2, (y0 + y1) / 2, { zoom, duration: motionMs(500) });
  }, [layout, setCenter, store]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // The legend starts open where there is room for it; on a phone it would cover most of the map.
  // (This tab only renders client-side, after a paper has loaded, so reading the viewport is safe.)
  const [legendOpenAtStart] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches
  );

  const linkById = useMemo(() => new Map(graph.links.map((l) => [l.id, l])), [graph.links]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const flowNodes: ConceptFlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const box = layout.nodes[n.id];
        const pk = n.paramKey;
        return {
          id: n.id,
          type: "concept" as const,
          position: { x: box?.x ?? 0, y: box?.y ?? 0 },
          width: box?.w,
          height: box?.h,
          draggable: false,
          connectable: false,
          data: {
            node: n,
            w: box?.w ?? 236,
            h: box?.h ?? 100,
            emphasis: nodeEmphasis.get(n.id) ?? "normal",
            value: pk ? (paramValues[pk] ?? n.param?.default_val) : undefined,
            pulsed: pulsedIds.has(n.id) || (!!pk && (pulsedIds.has(pk) || pulsedIds.has(`param-${pk}`))),
          },
        };
      }),
    [graph.nodes, layout, nodeEmphasis, paramValues, pulsedIds]
  );

  const flowEdges: RelationFlowEdge[] = useMemo(
    () =>
      graph.links.map((l) => {
        const r = layout.edges[l.id];
        const state = edgeEmphasis.get(l.id) ?? "normal";
        return {
          id: l.id,
          source: l.source,
          target: l.target,
          type: "relation" as const,
          zIndex: state === "active" ? 1 : 0,
          data: {
            link: l,
            points: r?.points ?? [],
            labelX: r?.labelX ?? 0,
            labelY: r?.labelY ?? 0,
            labelW: r?.labelW ?? 120,
            labelLines: r?.labelLines ?? 1,
            state,
            hovered: hover?.id === l.id,
          },
        };
      }),
    [graph.links, layout, edgeEmphasis, hover?.id]
  );

  const setHoverFromEvent = useCallback((id: string | null, e?: React.MouseEvent) => {
    if (!id || !e || !wrapRef.current) {
      setHover(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    setHover({ id, x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height });
  }, []);

  const interaction: EdgeInteraction = useMemo(
    () => ({
      hover: setHoverFromEvent,
      activate: (edgeId: string) => {
        const l = linkById.get(edgeId);
        if (l) onActivateLink(l);
      },
    }),
    [setHoverFromEvent, linkById, onActivateLink]
  );

  const presentKinds = useMemo(() => {
    const counts = new Map<ConceptKind, number>();
    for (const n of graph.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return KIND_ORDER.filter((k) => counts.has(k)).map((k) => ({ kind: k, count: counts.get(k) ?? 0 }));
  }, [graph.nodes]);

  const presentLinkKinds = useMemo(() => {
    const s = new Set<LinkKind>(graph.links.map((l) => l.kind));
    return LINK_ORDER.filter((k) => s.has(k));
  }, [graph.links]);

  const hoverLink = hover ? linkById.get(hover.id) : undefined;

  const pick = (id: string) => {
    onQueryChange("");
    setSearchOpen(false);
    onSelect(id);
  };

  return (
    <EdgeInteractionContext.Provider value={interaction}>
      {/* Glass sheet; overflow-hidden only rounds the pane (every overlay below is kept inside it). */}
      <div ref={wrapRef} className="apple-sheet relative h-full w-full overflow-hidden rounded-[26px]">
        {/* flow-along-edge animation (frozen by the global reduced-motion rule) */}
        <style>{`@keyframes cg-dash{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}.cg-flow{animation:cg-dash .9s linear infinite}`}</style>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          // No `fitView` prop: React Flow would queue its own initial fit and run it at a later
          // nodes update, snapping the camera back after onReady's opening zoom.
          onInit={onReady}
          minZoom={0.15}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // Edges themselves can't be selected, and their label buttons (focusable, with a focus
          // ring) already follow the link, so the SVG edges would only be invisible tab stops.
          edgesFocusable={false}
          onNodeClick={(_, n) => onSelect(n.id)}
          onEdgeClick={(_, e) => {
            const l = linkById.get(e.id);
            if (l) onActivateLink(l);
          }}
          onEdgeMouseEnter={(e, edge) => setHoverFromEvent(edge.id, e)}
          onEdgeMouseMove={(e, edge) => setHoverFromEvent(edge.id, e)}
          onEdgeMouseLeave={() => setHover(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--border-strong)" />
          {/* Top-left, under the search box: the bottom-left belongs to the legend, so the two
              can't collide at any width. */}
          <Controls
            showInteractive={false}
            position="top-left"
            style={{ marginTop: 58, marginLeft: 12 }}
            className="!overflow-hidden !rounded-2xl !border !border-[var(--glass-rim)] !shadow-[var(--shadow-card)]"
          />
        </ReactFlow>

        {/* Toolbar: search + fit */}
        <div className="absolute left-3 right-3 top-3 z-10 flex items-start gap-2">
          <div className="relative min-w-0 w-full max-w-[300px]">
            <div className="apple-glass-elevated flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(e) => {
                  onQueryChange(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => setSearchOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) pick(matches[0].id);
                  if (e.key === "Escape") {
                    onQueryChange("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="Find a concept or parameter…"
                aria-label="Search the concept graph"
                className="min-w-0 w-full bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onQueryChange("")}
                  className="apple-press apple-focus shrink-0 rounded-full p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {searchOpen && query.trim() && (
              <div className="apple-glass-elevated st-fade-down absolute left-0 right-0 top-full mt-1.5 overflow-hidden rounded-2xl border">
                {matches.length === 0 ? (
                  <p className="px-3 py-2.5 text-[11.5px] text-[var(--text-muted)]">Nothing matches “{query}”.</p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto py-1">
                    {matches.slice(0, 8).map((n) => {
                      const m = KIND_META[n.kind];
                      const Icon = m.icon;
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(n.id)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-surface-muted)]"
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: m.color }} />
                            <RichText className="min-w-0 flex-1 truncate" text={n.label} />
                            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{m.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={showWholeMap}
            aria-label="Show the whole map"
            title="Show the whole map"
            className="apple-glass-elevated apple-press apple-focus ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Whole map</span>
          </button>
        </div>

        {/* Legend + kind spotlight */}
        {/* Legend: its body scrolls inside itself on short canvases rather than being cut off. */}
        <details open={legendOpenAtStart} className="group/legend apple-glass-elevated absolute bottom-3 left-3 z-10 max-w-[calc(100%-5.5rem)] rounded-2xl border text-[11px] sm:max-w-[min(440px,calc(100%-12rem))]">
          <summary className="apple-focus cursor-pointer select-none list-none rounded-2xl px-3 py-1.5 font-medium text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]">Legend</span>
            <span className="ml-2 font-normal text-[var(--text-muted)] group-open/legend:hidden">show</span>
            <span className="ml-2 hidden font-normal text-[var(--text-muted)] group-open/legend:inline">
              tap a kind to spotlight it
            </span>
          </summary>
          <div className="max-h-[min(40vh,14rem)] space-y-2 overflow-y-auto px-3 pb-2.5 pt-0.5">
            <div className="flex flex-wrap gap-1.5 p-0.5">
              {presentKinds.map(({ kind, count }) => {
                const m = KIND_META[kind];
                const Icon = m.icon;
                const on = spotlight.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    title={m.blurb}
                    aria-pressed={on}
                    onClick={() => onToggleKind(kind)}
                    className="apple-press apple-focus flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium"
                    style={{
                      borderColor: on ? m.color : mix(m.color, 30),
                      background: on ? mix(m.color, 18) : "var(--bg-surface)",
                      color: on ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    <Icon className="h-3 w-3" style={{ color: m.color }} />
                    {count > 1 ? m.plural : m.label}
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">{count}</span>
                  </button>
                );
              })}
            </div>
            {presentLinkKinds.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-secondary)]">
                {presentLinkKinds.map((k) => {
                  const m = LINK_META[k];
                  return (
                    <span key={k} className="flex items-center gap-1.5" title={m.blurb}>
                      <svg width="22" height="8" aria-hidden>
                        <line x1="0" y1="4" x2="16" y2="4" style={{ stroke: m.color }} strokeWidth="2" strokeDasharray={m.dash} />
                        <polygon points="16,0.5 22,4 16,7.5" style={{ fill: m.color }} />
                      </svg>
                      {m.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </details>

        {/* Edge tooltip */}
        {hover && hoverLink && (
          <div
            role="tooltip"
            className="apple-glass-elevated pointer-events-none absolute z-20 w-[min(260px,calc(100%-16px))] rounded-2xl border p-3"
            style={{
              left: Math.min(Math.max(8, hover.x + 14), Math.max(8, hover.w - 272)),
              // Flip above the cursor in the lower half so the sheet's rounded clip never cuts it.
              ...(hover.y > hover.h / 2 ? { bottom: hover.h - hover.y + 12 } : { top: hover.y + 16 }),
            }}
          >
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: LINK_META[hoverLink.kind].color }}>
              {LINK_META[hoverLink.kind].label}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[12px] leading-snug text-[var(--text-primary)]">
              <RichText className="font-semibold" text={nodeById.get(hoverLink.source)?.label ?? ""} />
              <ArrowRight className="h-3 w-3 text-[var(--text-muted)]" />
              <RichText className="italic text-[var(--text-secondary)]" text={hoverLink.relation} />
              <ArrowRight className="h-3 w-3 text-[var(--text-muted)]" />
              <RichText className="font-semibold" text={nodeById.get(hoverLink.target)?.label ?? ""} />
            </p>
            {hoverLink.explanation && (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
                <RichText text={hoverLink.explanation} />
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Click to follow this link</p>
          </div>
        )}
      </div>
    </EdgeInteractionContext.Provider>
  );
}
