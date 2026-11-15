"use client";

import React from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { MapPin } from "lucide-react";
import { RichText, Tex } from "../../math/MathTex";
import { KIND_META, mix } from "./kinds";
import { formatParamValue, paramSymbol, sourceOf, type CNode } from "./model";

export type NodeEmphasis = "normal" | "dim" | "focus" | "selected";

export type ConceptNodeData = {
  node: CNode;
  w: number;
  h: number;
  emphasis: NodeEmphasis;
  value?: number;
  pulsed: boolean;
};

export type ConceptFlowNode = Node<ConceptNodeData, "concept">;

const hiddenHandle: React.CSSProperties = {
  width: 6,
  height: 6,
  minWidth: 0,
  minHeight: 0,
  opacity: 0,
  border: 0,
  pointerEvents: "none",
};

export function ConceptNodeCard({ data }: NodeProps<ConceptFlowNode>) {
  const { node, w, h, emphasis, value, pulsed } = data;
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const color = meta.color;
  const src = sourceOf(node);
  const page = src?.page;
  const symbol = paramSymbol(node);
  const p = node.param;
  const selected = emphasis === "selected";
  const dim = emphasis === "dim";

  // Glass node (Meadow Glass): thick surface, bright rim and inner top highlight, 16px corners,
  // the kind's hue in the rim and a faint wash. Emphasis reads from the outer ring: selected = the
  // accent ring + soft halo, focus = a thin kind ring, dim = faded (no CSS filter on glass).
  const highlight = "inset 0 1px 0 var(--glass-highlight), inset 0 -1px 1px var(--glass-lowlight)";
  const ring = selected
    ? `${highlight}, 0 0 0 2px var(--accent), 0 0 0 6px var(--accent-soft), var(--shadow-elevated)`
    : pulsed
      ? `${highlight}, 0 0 0 2px var(--status-warning), 0 0 22px var(--status-warning-soft)`
      : emphasis === "focus"
        ? `${highlight}, 0 0 0 1px ${mix(color, 50)}, var(--shadow-card-hover)`
        : `${highlight}, var(--shadow-card)`;
  // Small caps in the kind's hue, except on a dimmed node, where the hue would fall under 4.5:1.
  const kindText = dim ? "var(--text-secondary)" : color;

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-[16px] border text-left transition-[transform,opacity,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 ${
        pulsed ? "st-float" : ""
      }`}
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        cursor: "pointer",
        borderColor: selected ? "var(--accent)" : emphasis === "focus" ? mix(color, 45) : mix(color, node.isRoot ? 45 : 30),
        // Dimmed nodes sit on the solid surface so lit edges behind them don't run through their
        // text, and stay at 0.72 so even their smallest text clears 4.5:1.
        background: `linear-gradient(160deg, var(--glass-specular), transparent 34%), linear-gradient(165deg, ${mix(color, node.isRoot ? 18 : selected ? 13 : 8)} 0%, transparent 72%), ${dim ? "var(--bg-surface-solid)" : "var(--bg-surface)"}`,
        boxShadow: ring,
        opacity: dim ? 0.72 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={hiddenHandle} />

      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[8px]"
          style={{ background: mix(color, 16), color }}
        >
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </span>
        <span
          className="truncate font-mono text-[10px] font-medium uppercase"
          style={{ color: kindText, letterSpacing: "0.08em" }}
        >
          {node.isRoot ? "The paper · start here" : meta.label}
        </span>
        {page != null && (
          <span
            title={`Found on page ${page}${src?.section ? `, ${src.section}` : ""}`}
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1.5 py-[1px] font-mono text-[10px] font-medium text-[var(--text-secondary)]"
          >
            <MapPin className="h-2.5 w-2.5" />p.{page}
          </span>
        )}
      </div>

      <div
        className={`px-3 pt-1.5 font-medium tracking-[-0.01em] text-[var(--text-primary)] ${
          node.isRoot ? "text-[14.5px]" : "text-[12.5px]"
        }`}
        style={{
          display: "-webkit-box",
          WebkitLineClamp: node.isRoot ? 3 : 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          lineHeight: 1.3,
        }}
        title={node.label}
      >
        <RichText text={node.label} />
      </div>

      {node.kind === "parameter" && (
        <div className="mt-auto px-3 pb-2.5">
          <div className="flex items-center gap-2 text-[11px]">
            {symbol && (
              <span className="max-w-[90px] truncate text-[var(--text-primary)]">
                <Tex latex={symbol} />
              </span>
            )}
            {value != null && (
              <span
                title={`= ${formatParamValue(value, p?.unit)}`}
                className="ml-auto min-w-0 truncate rounded-full px-2 py-[1px] font-mono text-[11px] font-medium tabular-nums"
                style={{ background: mix(color, 16), color: dim ? "var(--text-primary)" : color }}
              >
                = {formatParamValue(value, p?.unit)}
              </span>
            )}
          </div>
        </div>
      )}

      {node.kind !== "parameter" && !node.isRoot && node.summary && (
        // Two clamped lines. Every descendant is forced inline: a block-level child broke the clamp
        // (an ellipsis mid-sentence, then a half-cut second line with clipped descenders).
        <p
          className="px-3 pb-2.5 pt-1 text-[11px] leading-snug text-[var(--text-secondary)] [&_*]:!inline"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          <RichText text={node.summary} />
        </p>
      )}

      <Handle type="source" position={Position.Bottom} isConnectable={false} style={hiddenHandle} />
    </div>
  );
}
