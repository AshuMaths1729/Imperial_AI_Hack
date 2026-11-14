"use client";

import React, { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  Node,
  Edge,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNodeData, GraphEdgeData, UIAnnotation } from "../types/scholartwin";
import { useTheme } from "./ThemeProvider";

interface GraphCanvasProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  selectedEdgeId?: string | null;
  annotations: UIAnnotation[];
  onSelectNode: (node: GraphNodeData) => void;
  onSelectEdge?: (edge: GraphEdgeData) => void;
}

const EDGE_PALETTE: Record<
  "dark" | "light" | "contrast",
  Record<GraphEdgeData["type"], { color: string; dash?: string; label: string }>
> = {
  dark: {
    prerequisite: { color: "#4d9eff", label: "Prerequisite" },
    supports: { color: "#2dd4bf", label: "Supports" },
    contradicts: { color: "#ff8a3d", dash: "10 4 2 4", label: "Contradicts" },
    gap: { color: "#e879f9", dash: "6 4", label: "Research Gap" },
  },
  light: {
    prerequisite: { color: "#0066cc", label: "Prerequisite" },
    supports: { color: "#007d67", label: "Supports" },
    contradicts: { color: "#d55e00", dash: "10 4 2 4", label: "Contradicts" },
    gap: { color: "#9d2b7d", dash: "6 4", label: "Research Gap" },
  },
  contrast: {
    prerequisite: { color: "#56b4e9", label: "Prerequisite" },
    supports: { color: "#00d09c", label: "Supports" },
    contradicts: { color: "#ff944d", dash: "10 4 2 4", label: "Contradicts" },
    gap: { color: "#f094d8", dash: "6 4", label: "Research Gap" },
  },
};

function GraphCanvasInner({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  annotations,
  onSelectNode,
  onSelectEdge,
}: GraphCanvasProps) {
  const { fitView } = useReactFlow();
  const { theme } = useTheme();
  const isDark = theme === "dark" || theme === "contrast";
  const palette = EDGE_PALETTE[theme];

  useEffect(() => {
    if (!selectedNodeId) return;
    const neighborIds = new Set<string>([selectedNodeId]);
    for (const e of edges) {
      if (e.source === selectedNodeId) neighborIds.add(e.target);
      if (e.target === selectedNodeId) neighborIds.add(e.source);
    }
    fitView({
      nodes: Array.from(neighborIds).map((id) => ({ id })),
      padding: 0.35,
      duration: 420,
    });
  }, [selectedNodeId, edges, fitView]);

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

  const presentEdgeTypes = useMemo(() => {
    const types = new Set<GraphEdgeData["type"]>();
    for (const e of edges) types.add(e.type);
    return Array.from(types);
  }, [edges]);

  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const isSelected = n.id === selectedNodeId;
        const isPulsed = pulsedIds.has(n.id);
        const isGap = n.category === "gap";
        const isDetached = edges.length > 0 && !connectedIds.has(n.id);
        const citation = n.authors_year || n.slide_ref;

        const accentColor = isDark ? "#38bdf8" : "#0066cc";
        const warnColor = isDark ? "#fbbf24" : "#b45309";
        const gapColor = isDark ? "#e879f9" : "#9d2b7d";

        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          data: {
            label: (
              <div className="space-y-1 text-left">
                <div className="leading-snug">{n.label}</div>
                {citation && (
                  <div
                    className={`truncate text-[10px] font-normal ${
                      isDetached ? "text-[var(--text-muted)]" : "text-[var(--accent)]"
                    }`}
                  >
                    {citation}
                  </div>
                )}
              </div>
            ),
          },
          style: {
            width: 220,
            padding: "10px 12px",
            borderRadius: "12px",
            fontSize: "12px",
            fontWeight: 600,
            color: isDetached ? (isDark ? "#94a3b8" : "#64748b") : isDark ? "#f8fafc" : "#0f172a",
            opacity: isDetached && !isSelected ? 0.5 : 1,
            background: isDetached
              ? isDark
                ? "#181e2b"
                : "#f1f5f9"
              : isGap
              ? isDark
                ? "#2a1236"
                : "#fdf4ff"
              : isDark
              ? "#11151e"
              : "#ffffff",
            border: isPulsed
              ? `2px solid ${warnColor}`
              : isSelected
              ? `2px solid ${accentColor}`
              : isGap
              ? `1.5px dashed ${gapColor}`
              : `1px solid ${isDark ? "#334155" : "#cbd5e1"}`,
            boxShadow: isPulsed
              ? `0 0 18px ${isDark ? "rgba(251, 191, 36, 0.35)" : "rgba(180, 83, 9, 0.25)"}`
              : isDark
              ? "0 4px 14px rgba(0,0,0,0.4)"
              : "0 4px 14px rgba(15,23,42,0.08)",
          },
        };
      }),
    [nodes, edges.length, selectedNodeId, pulsedIds, connectedIds, isDark]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const spec = palette[e.type];
        const isSelected = e.id === selectedEdgeId;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: onSelectEdge ? undefined : e.label,
          animated: e.type === "contradicts" || e.type === "gap",
          interactionWidth: 24,
          style: {
            stroke: spec.color,
            strokeWidth: isSelected ? 4 : 2.4,
            strokeDasharray: spec.dash,
            cursor: onSelectEdge ? "pointer" : undefined,
          },
          labelStyle: { fill: isDark ? "#cbd5e1" : "#334155", fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: isDark ? "#11151e" : "#ffffff", fillOpacity: 0.9 },
          markerEnd: { type: MarkerType.ArrowClosed, color: spec.color },
        };
      }),
    [edges, selectedEdgeId, onSelectEdge, palette, isDark]
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        onNodeClick={(_, node) => {
          const found = nodes.find((n) => n.id === node.id);
          if (found) onSelectNode(found);

          const neighborIds = new Set<string>([node.id]);
          for (const e of edges) {
            if (e.source === node.id) neighborIds.add(e.target);
            if (e.target === node.id) neighborIds.add(e.source);
          }
          fitView({
            nodes: Array.from(neighborIds).map((id) => ({ id })),
            padding: 0.35,
            duration: 450,
          });
        }}
        onEdgeClick={(_, edge) => {
          if (!onSelectEdge) return;
          const found = edges.find((e) => e.id === edge.id);
          if (found) onSelectEdge(found);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color={isDark ? "#1e293b" : "#cbd5e1"} gap={20} />
        <Controls
          className="!rounded-xl !border !border-[var(--border-subtle)] !bg-[var(--bg-surface)] !text-[var(--text-primary)] !shadow-sm"
        />
      </ReactFlow>

      {/* CVD-Safe Edge Legend (color + dash pattern) */}
      {presentEdgeTypes.length > 0 && (
        <div className="apple-glass pointer-events-none absolute bottom-3 right-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
          {presentEdgeTypes.map((type) => {
            const spec = palette[type];
            return (
              <div key={type} className="flex items-center gap-1.5">
                <svg width="20" height="8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="20"
                    y2="4"
                    stroke={spec.color}
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
