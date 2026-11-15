"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  Node,
  Edge,
  useReactFlow,
  type FitViewOptions,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNodeData, GraphEdgeData, UIAnnotation } from "../types/scholartwin";

/** A tinted, non-interactive rectangle drawn behind a group of nodes (e.g. one paper's claims). */
export interface CanvasFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

interface GraphCanvasProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  selectedEdgeId?: string | null;
  annotations: UIAnnotation[];
  onSelectNode: (node: GraphNodeData) => void;
  onSelectEdge?: (edge: GraphEdgeData) => void;
  /** Clicking empty canvas. */
  onClearSelection?: () => void;
  /** Group frames drawn behind the nodes. */
  frames?: CanvasFrame[];
  /** Which nodes to frame when `id` is focused (default: it and its direct neighbours). */
  focusIds?: (id: string) => string[];
  /** Padding for focus zooms, e.g. extra bottom room when a details bubble covers the canvas. */
  focusPadding?: FitViewOptions["padding"];
  /** An extra small line under a node's citation (e.g. "3 claims"). */
  nodeMeta?: (id: string) => string | undefined;
  /** Where the zoom controls sit. Top-left keeps them clear of a bubble docked at the bottom. */
  controlsPosition?: "bottom-left" | "top-left";
}

/** Edge styling from theme tokens, so light / dark / high-contrast all match the legend. */
const EDGE_PALETTE: Record<GraphEdgeData["type"], { color: string; dash?: string; label: string }> = {
  prerequisite: { color: "var(--accent)", label: "Prerequisite" },
  supports: { color: "var(--status-support)", label: "Supports" },
  contradicts: { color: "var(--status-contradict)", dash: "10 4 2 4", label: "Contradicts" },
  gap: { color: "var(--status-gap)", dash: "6 4", label: "Research Gap" },
};

/** maxZoom stops a lone node from filling the whole canvas. */
const FIT = { padding: 0.3, maxZoom: 1.1 } as const;

/** Diagonal specular sheen layered over a glass node's fill. */
const NODE_SHEEN = "linear-gradient(150deg, var(--glass-specular), transparent 42%, transparent 78%, var(--glass-specular-2))";

const KIND_TAG: Partial<Record<GraphNodeData["category"], { text: string; color: string }>> = {
  gap: { text: "Open question", color: "var(--status-gap)" },
};

function GraphCanvasInner({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  annotations,
  onSelectNode,
  onSelectEdge,
  onClearSelection,
  frames,
  focusIds,
  focusPadding,
  nodeMeta,
  controlsPosition = "bottom-left",
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();
  const palette = EDGE_PALETTE;

  const neighbourIds = useCallback(
    (id: string) => {
      if (focusIds) return focusIds(id);
      const ids = new Set<string>([id]);
      for (const e of edges) {
        if (e.source === id) ids.add(e.target);
        if (e.target === id) ids.add(e.source);
      }
      return Array.from(ids);
    },
    [edges, focusIds]
  );
  const focusFit = useCallback(
    (id: string) => ({ ...FIT, padding: focusPadding ?? FIT.padding, nodes: neighbourIds(id).map((nid) => ({ id: nid })) }),
    [neighbourIds, focusPadding]
  );

  // First view (decided once, so the object stays stable for React Flow): the node that was
  // selected when the graph opened (e.g. the last one clicked in a saved chat) with its
  // neighbours, otherwise the whole graph. Never "whatever node happens to be first".
  const [initialFit] = useState(() => (selectedNodeId ? focusFit(selectedNodeId) : { ...FIT }));
  const zoomedFor = useRef<string | null>(selectedNodeId);

  // Later selection changes (a click, or a node picked outside the canvas) zoom in.
  useEffect(() => {
    if (!selectedNodeId || zoomedFor.current === selectedNodeId) return;
    zoomedFor.current = selectedNodeId;
    void fitView({ ...focusFit(selectedNodeId), duration: 450 });
  }, [selectedNodeId, focusFit, fitView]);
  useEffect(() => {
    if (!selectedNodeId) zoomedFor.current = null;
  }, [selectedNodeId]);

  const pulsedIds = useMemo(
    () => new Set(annotations.filter((a) => a.type === "pulse_node").map((a) => a.target_id)),
    [annotations]
  );

  const connectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of edges) {
      ids.add(e.source);
      ids.add(e.target);
    }
    return ids;
  }, [edges]);

  // While a node is selected, its neighbourhood stays bright and the rest steps back.
  const focus = useMemo(
    () => (selectedNodeId ? new Set(neighbourIds(selectedNodeId)) : null),
    [selectedNodeId, neighbourIds]
  );

  const presentEdgeTypes = useMemo(() => {
    const types = new Set<GraphEdgeData["type"]>();
    for (const e of edges) types.add(e.type);
    return Array.from(types);
  }, [edges]);

  const flowNodes: Node[] = useMemo(() => {
    const frameNodes: Node[] = (frames ?? []).map((f) => ({
      id: f.id,
      position: { x: f.x, y: f.y },
      data: { label: null },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -1,
      style: {
        width: f.width,
        height: f.height,
        padding: 0,
        borderRadius: 18,
        border: `1px solid color-mix(in srgb, ${f.color} 22%, transparent)`,
        background: `color-mix(in srgb, ${f.color} 5%, transparent)`,
        boxShadow: "none",
        pointerEvents: "none",
      },
    }));

    const graphNodes: Node[] = nodes.map((n) => {
      const isSelected = n.id === selectedNodeId;
      const isPulsed = pulsedIds.has(n.id);
      const isGap = n.category === "gap";
      // Anything with no line to anything else is greyed out.
      const isDetached = edges.length > 0 && !connectedIds.has(n.id);
      const dimmed = focus !== null && !focus.has(n.id);
      const citation = n.authors_year || n.slide_ref;
      const tag = KIND_TAG[n.category];
      const meta = nodeMeta?.(n.id);
      const borderWidth = isPulsed || isSelected ? 2 : isGap ? 1.5 : 1;

      return {
        id: n.id,
        position: { x: n.x, y: n.y },
        data: {
          label: (
            <div className="space-y-1 text-left">
              {tag && (
                <div
                  className="text-[9.5px] font-bold uppercase"
                  style={{ color: tag.color, letterSpacing: "0.06em" }}
                >
                  {tag.text}
                </div>
              )}
              <div className="leading-snug">{n.label}</div>
              {citation && (
                <div
                  title={citation}
                  className={`truncate text-[10px] font-normal ${
                    isDetached ? "text-[var(--text-muted)]" : "text-[var(--accent)]"
                  }`}
                >
                  {citation}
                </div>
              )}
              {meta && <div className="text-[10px] font-medium text-[var(--text-muted)]">{meta}</div>}
            </div>
          ),
        },
        style: {
          width: 220,
          // Padding shrinks as the border grows, so selecting a node never shifts its text.
          padding: `${11 - borderWidth}px ${13 - borderWidth}px`,
          borderRadius: 16,
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "opacity 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
          color: isDetached ? "var(--text-muted)" : "var(--text-primary)",
          // Dimmed (outside the focus) but still legible: 0.35 dropped labels to ~2:1.
          opacity: dimmed ? 0.5 : isDetached && !isSelected ? 0.6 : 1,
          // Glass node: thick translucent fill with a diagonal specular sheen. Detached nodes
          // drop the sheen and sit on the muted wash, so "stands alone" reads as greyed out.
          background: isDetached
            ? "var(--bg-surface-muted)"
            : isGap
              ? `${NODE_SHEEN}, linear-gradient(var(--status-gap-soft), var(--status-gap-soft)), var(--bg-surface)`
              : `${NODE_SHEEN}, var(--bg-surface)`,
          border: isPulsed
            ? `${borderWidth}px solid var(--status-warning)`
            : isSelected
              ? `${borderWidth}px solid var(--accent)`
              : isGap
                ? `${borderWidth}px dashed var(--status-gap)`
                : isDetached
                  ? `${borderWidth}px solid var(--border-strong)`
                  : `${borderWidth}px solid var(--glass-rim)`,
          boxShadow: isPulsed
            ? "inset 0 1px 0 var(--glass-highlight), 0 0 18px var(--status-warning-soft)"
            : isSelected
              ? "inset 0 1px 0 var(--glass-highlight), 0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent), var(--shadow-card)"
              : isDetached
                ? "none"
                : "inset 0 1px 0 var(--glass-highlight), 0 0 0 1px var(--border-subtle), var(--shadow-card)",
        },
      };
    });
    return [...frameNodes, ...graphNodes];
  }, [frames, nodes, edges.length, selectedNodeId, pulsedIds, connectedIds, focus, nodeMeta]);

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const spec = palette[e.type];
        const isSelected = e.id === selectedEdgeId;
        const touchesSelection = !selectedNodeId || e.source === selectedNodeId || e.target === selectedNodeId;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: onSelectEdge ? undefined : e.label,
          animated: e.type === "contradicts" || e.type === "gap",
          interactionWidth: 24,
          style: {
            stroke: spec.color,
            strokeWidth: isSelected ? 4 : touchesSelection && selectedNodeId ? 3 : 2.4,
            strokeDasharray: spec.dash,
            opacity: touchesSelection || isSelected ? 1 : 0.22,
            cursor: onSelectEdge ? "pointer" : undefined,
            transition: "opacity 220ms ease",
          },
          labelStyle: { fill: "var(--text-secondary)", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "var(--bg-surface)", fillOpacity: 0.92 },
          markerEnd: { type: MarkerType.ArrowClosed, color: spec.color },
        };
      }),
    [edges, selectedEdgeId, selectedNodeId, onSelectEdge, palette]
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={initialFit}
        minZoom={0.1}
        onNodeClick={(_, node) => {
          const found = nodes.find((n) => n.id === node.id);
          if (!found) return; // frames
          onSelectNode(found);
          // Also re-zoom when the already-selected node is clicked again.
          zoomedFor.current = node.id;
          void fitView({ ...focusFit(node.id), duration: 450 });
        }}
        onEdgeClick={(_, edge) => {
          if (!onSelectEdge) return;
          const found = edges.find((e) => e.id === edge.id);
          if (found) onSelectEdge(found);
        }}
        onPaneClick={onClearSelection}
        proOptions={{ hideAttribution: true }}
      >
        {/* Transparent pane: the glass panel (or colour field) behind shows through the dots. */}
        <Background color="var(--border-strong)" gap={20} size={1.2} />
        <Controls
          position={controlsPosition}
          className="apple-glass !rounded-[16px] !border text-[var(--text-primary)] [&>button]:!h-8 [&>button]:!w-8 [&>button]:!bg-transparent [&>button]:!border-[var(--border-subtle)] [&>button:hover]:!bg-[var(--bg-surface-muted)] [&>button:first-child]:rounded-t-[15px] [&>button:last-child]:rounded-b-[15px] [&>button:focus-visible]:outline-2 [&>button:focus-visible]:-outline-offset-2 [&>button:focus-visible]:outline-[var(--accent)]"
        />
      </ReactFlow>

      {/* CVD-safe edge legend (colour + dash pattern), top-right so bottom popovers never cover it */}
      {presentEdgeTypes.length > 0 && (
        <div
          className={`apple-glass pointer-events-none absolute right-3 top-3 z-10 flex ${
            // Stay clear of zoom controls docked top-left.
            controlsPosition === "top-left" ? "max-w-[calc(100%-5rem)]" : "max-w-[calc(100%-1.5rem)]"
          } flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-[20px] border px-3.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]`}
        >
          {presentEdgeTypes.map((type) => {
            const spec = palette[type];
            return (
              <div key={type} className="flex items-center gap-1.5 whitespace-nowrap">
                <svg width="20" height="8" aria-hidden className="shrink-0">
                  <line
                    x1="0"
                    y1="4"
                    x2="20"
                    y2="4"
                    style={{ stroke: spec.color }}
                    strokeWidth="2.5"
                    strokeDasharray={spec.dash}
                  />
                </svg>
                <span>{spec.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
