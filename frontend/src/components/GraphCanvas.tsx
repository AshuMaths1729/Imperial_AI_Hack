"use client";

import React, { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Node,
  Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNodeData, GraphEdgeData, UIAnnotation } from "../types/scholartwin";

interface GraphCanvasProps {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedNodeId: string | null;
  annotations: UIAnnotation[];
  onSelectNode: (node: GraphNodeData) => void;
}

const EDGE_COLORS: Record<GraphEdgeData["type"], string> = {
  prerequisite: "#38bdf8",
  supports: "#22c55e",
  contradicts: "#ef4444",
  gap: "#a855f7",
};

export function GraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  annotations,
  onSelectNode,
}: GraphCanvasProps) {
  const pulsedIds = useMemo(
    () => new Set(annotations.filter((a) => a.type === "pulse_node").map((a) => a.target_id)),
    [annotations]
  );

  const flowNodes: Node[] = useMemo(
    () =>
      nodes.map((n) => {
        const isSelected = n.id === selectedNodeId;
        const isPulsed = pulsedIds.has(n.id);
        const isGap = n.category === "gap";

        return {
          id: n.id,
          position: { x: n.x, y: n.y },
          data: { label: n.label },
          style: {
            width: 210,
            padding: "10px 12px",
            borderRadius: "10px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#f8fafc",
            background: isGap ? "#2e1065" : "#0f172a",
            border: isPulsed
              ? "2px solid #f59e0b"
              : isSelected
              ? "2px solid #38bdf8"
              : isGap
              ? "1.5px dashed #a855f7"
              : "1px solid #334155",
            boxShadow: isPulsed ? "0 0 18px rgba(245, 158, 11, 0.45)" : "0 4px 12px rgba(0,0,0,0.35)",
          },
        };
      }),
    [nodes, selectedNodeId, pulsedIds]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const color = EDGE_COLORS[e.type];
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: e.type === "contradicts" || e.type === "gap",
          style: {
            stroke: color,
            strokeWidth: 2,
            strokeDasharray: e.type === "gap" ? "6 4" : undefined,
          },
          labelStyle: { fill: "#cbd5e1", fontSize: 10, fontWeight: 500 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
        };
      }),
    [edges]
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
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls className="!bg-slate-900 !border-slate-700 !text-slate-200" />
      </ReactFlow>
    </div>
  );
}
