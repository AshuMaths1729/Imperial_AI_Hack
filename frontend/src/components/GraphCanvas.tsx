"use client";

import React, { useMemo } from "react";
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

interface GraphCanvasProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  selectedEdgeId?: string | null;
  annotations: UIAnnotation[];
  onSelectNode: (node: GraphNodeData) => void;
  onSelectEdge?: (edge: GraphEdgeData) => void;
}

const EDGE_COLORS: Record<GraphEdgeData["type"], string> = {
  prerequisite: "#38bdf8",
  supports: "#22c55e",
  contradicts: "#ef4444",
  gap: "#a855f7",
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

  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const isSelected = n.id === selectedNodeId;
        const isPulsed = pulsedIds.has(n.id);
        const isGap = n.category === "gap";
        const isDetached = edges.length > 0 && !connectedIds.has(n.id);
        const citation = n.authors_year || n.slide_ref;

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
                      isDetached ? "text-slate-500" : "text-sky-300/80"
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
            borderRadius: "10px",
            fontSize: "12px",
            fontWeight: 600,
            color: isDetached ? "#94a3b8" : "#f8fafc",
            opacity: isDetached && !isSelected ? 0.42 : 1,
            background: isDetached ? "#1e293b" : isGap ? "#2e1065" : "#0f172a",
            border: isPulsed
              ? "2px solid #f59e0b"
              : isSelected
              ? "2px solid #38bdf8"
              : isGap
              ? "1.5px dashed #a855f7"
              : "1px solid #334155",
            boxShadow: isPulsed
              ? "0 0 18px rgba(245, 158, 11, 0.45)"
              : "0 4px 12px rgba(0,0,0,0.35)",
          },
        };
      }),
    [nodes, edges.length, selectedNodeId, pulsedIds, connectedIds]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const color = EDGE_COLORS[e.type];
        const isSelected = e.id === selectedEdgeId;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: onSelectEdge ? undefined : e.label,
          animated: e.type === "contradicts" || e.type === "gap",
          interactionWidth: 24,
          style: {
            stroke: color,
            strokeWidth: isSelected ? 4 : 2.2,
            strokeDasharray: e.type === "gap" ? "6 4" : undefined,
            cursor: onSelectEdge ? "pointer" : undefined,
          },
          labelStyle: { fill: "#cbd5e1", fontSize: 10, fontWeight: 500 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        };
      }),
    [edges, selectedEdgeId, onSelectEdge]
  );

  return (
    <div className="h-full w-full">
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
        <Background color="#1e293b" gap={20} />
        <Controls className="!bg-slate-900 !border-slate-700 !text-slate-200" />
      </ReactFlow>
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
