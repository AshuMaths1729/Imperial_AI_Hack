"use client";

import React, { createContext, useContext } from "react";
import { RichText } from "../../math/MathTex";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { LINK_META, mix } from "./kinds";
import { LABEL_FONT_PX, LABEL_LINE_PX } from "./layout";
import type { CLink } from "./model";

export type EmphasisState = "normal" | "dim" | "active";

export type RelationEdgeData = {
  link: CLink;
  points: { x: number; y: number }[];
  labelX: number;
  labelY: number;
  labelW: number;
  labelLines: number;
  state: EmphasisState;
  hovered: boolean;
};

export type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

/** Canvas-level callbacks for edge labels (labels live outside the SVG edge layer). */
export interface EdgeInteraction {
  hover: (edgeId: string | null, e?: React.MouseEvent) => void;
  activate: (edgeId: string) => void;
}
export const EdgeInteractionContext = createContext<EdgeInteraction>({
  hover: () => {},
  activate: () => {},
});

const ARROW = 7;

/** Smooth path through waypoints with vertical tangents (reads as a top-down flow, never loops). */
function buildPath(pts: { x: number; y: number }[]): string {
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dy = b.y - a.y;
    const k = dy > 0 ? dy * 0.5 : Math.max(40, Math.abs(dy) * 0.5);
    d += ` C ${a.x},${a.y + k} ${b.x},${b.y - k} ${b.x},${b.y}`;
  }
  return d;
}

export function RelationEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<RelationFlowEdge>) {
  const ctx = useContext(EdgeInteractionContext);
  if (!data) return null;
  const { link, points, labelX, labelY, labelW, labelLines, state, hovered } = data;
  const meta = LINK_META[link.kind];
  const color = meta.color;
  const end = { x: targetX, y: targetY - ARROW + 1 };
  const path = buildPath([{ x: sourceX, y: sourceY }, ...points, end]);
  const active = state === "active" || hovered;
  const dim = state === "dim" && !hovered;
  const opacity = dim ? 0.3 : 1;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={22}
        style={{
          stroke: color,
          strokeWidth: active ? 3 : 2.1,
          strokeDasharray: meta.dash,
          opacity: active ? 1 : dim ? opacity : 0.9,
          transition: "opacity 220ms ease, stroke-width 160ms ease",
        }}
      />
      {active && (
        <path
          d={path}
          fill="none"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeDasharray="2 10"
          className="cg-flow"
          style={{ stroke: color, filter: `drop-shadow(0 0 3px ${mix(color, 60)})`, pointerEvents: "none" }}
        />
      )}
      <polygon
        points={`${targetX - 4.6},${targetY - ARROW} ${targetX + 4.6},${targetY - ARROW} ${targetX},${targetY + 0.5}`}
        style={{ fill: color, opacity: active ? 1 : dim ? opacity : 0.85, transition: "opacity 220ms ease" }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="nodrag nopan apple-focus absolute font-semibold"
          title={link.explanation ? `${link.relation}: ${link.explanation}` : link.relation}
          aria-label={`Relation: ${link.relation}`}
          onMouseEnter={(e) => ctx.hover(id, e)}
          onMouseMove={(e) => ctx.hover(id, e)}
          onMouseLeave={() => ctx.hover(null)}
          onClick={() => ctx.activate(id)}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)${active ? " scale(1.06)" : ""}`,
            maxWidth: labelW,
            pointerEvents: "all",
            cursor: "pointer",
            fontSize: LABEL_FONT_PX,
            lineHeight: `${LABEL_LINE_PX}px`,
            padding: "4px 10px",
            borderRadius: labelLines > 1 ? 10 : 999,
            textAlign: "center",
            background: active ? `linear-gradient(${mix(color, 14)}, ${mix(color, 14)}), var(--bg-surface)` : "var(--bg-surface)",
            border: `1px solid ${active ? color : mix(color, 38)}`,
            color: active ? "var(--text-primary)" : "var(--text-secondary)",
            boxShadow: active ? "var(--shadow-card-hover)" : "var(--shadow-card)",
            opacity: dim ? 0.45 : 1,
            transition: "opacity 220ms ease, transform 160ms ease, border-color 160ms ease",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            zIndex: active ? 2 : 1,
          }}
        >
          <RichText text={link.relation} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
