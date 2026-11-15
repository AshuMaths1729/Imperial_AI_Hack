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

  const ring = selected
    ? `0 0 0 2px ${color}, 0 0 0 6px ${mix(color, 18)}, var(--shadow-elevated)`
    : pulsed
      ? `0 0 0 2px var(--status-warning), 0 0 22px var(--status-warning-soft)`
      : emphasis === "focus"
        ? `0 0 0 1px ${mix(color, 55)}, var(--shadow-card-hover)`
        : "var(--shadow-card)";

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-[transform,opacity,box-shadow,filter] duration-200 ease-out hover:-translate-y-0.5 ${
        pulsed ? "st-float" : ""
      }`}
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        cursor: "pointer",
        borderColor: selected ? color : mix(color, node.isRoot ? 60 : 42),
        background: `linear-gradient(165deg, ${mix(color, node.isRoot ? 26 : 17)} 0%, ${mix(color, 5)} 70%), var(--bg-surface)`,
        boxShadow: ring,
        opacity: dim ? 0.5 : 1,
        filter: dim ? "saturate(0.7)" : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={hiddenHandle} />

      {/* kind stripe */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[4px]" style={{ background: color }} />

      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg"
          style={{ background: mix(color, 16), color }}
        >
          <Icon className="h-3 w-3" strokeWidth={2.4} />
        </span>
        <span
          className="apple-label truncate text-[9.5px] font-bold uppercase"
          style={{ color, letterSpacing: "0.08em" }}
        >
          {node.isRoot ? "The paper · start here" : meta.label}
        </span>
        {page != null && (
          <span
            title={`Found on page ${page}${src?.section ? `, ${src.section}` : ""}`}
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1.5 py-[1px] font-mono text-[9.5px] font-semibold text-[var(--text-secondary)]"
          >
            <MapPin className="h-2.5 w-2.5" />p.{page}
          </span>
        )}
      </div>

      <div
        className={`apple-heading px-3 pt-1.5 font-semibold text-[var(--text-primary)] ${
          node.isRoot ? "text-[14px]" : "text-[12.5px]"
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
                className="ml-auto rounded-md px-1.5 py-[1px] font-mono text-[10.5px] font-bold tabular-nums"
                style={{ background: mix(color, 16), color }}
              >
                = {formatParamValue(value, p?.unit)}
              </span>
            )}
          </div>
        </div>
      )}

      {node.kind !== "parameter" && !node.isRoot && node.summary && (
        <p
          className="px-3 pb-2.5 pt-1 text-[10.5px] leading-snug text-[var(--text-muted)]"
          style={{ display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          <RichText text={node.summary} />
        </p>
      )}

      <Handle type="source" position={Position.Bottom} isConnectable={false} style={hiddenHandle} />
    </div>
  );
}
