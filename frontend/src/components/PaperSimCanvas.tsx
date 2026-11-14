"use client";

import React from "react";
import { SimulationPayload, UIAnnotation } from "../types/scholartwin";

interface PaperSimCanvasProps {
  simulation: SimulationPayload;
  paramValues: Record<string, number>;
  annotations: UIAnnotation[];
  onParamChange: (key: string, val: number) => void;
}

export function PaperSimCanvas({
  simulation,
  paramValues,
  annotations,
  onParamChange,
}: PaperSimCanvasProps) {
  const width = 760;
  const height = 340;
  const pad = { top: 24, right: 24, bottom: 38, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const xs = simulation.x;
  const allY = simulation.series.flatMap((s) => s.y);
  const minX = xs.length ? xs[0] : 0;
  const maxX = xs.length ? xs[xs.length - 1] : 1;
  const minY = allY.length ? Math.min(...allY, -0.5) : -1;
  const maxY = allY.length ? Math.max(...allY, 1.5) : 2;
  const ySpan = maxY - minY || 1;
  const xSpan = maxX - minX || 1;

  const toSvgX = (x: number) => pad.left + ((x - minX) / xSpan) * plotW;
  const toSvgY = (y: number) => pad.top + plotH - ((y - minY) / ySpan) * plotH;

  const callouts = annotations.filter((a) => a.type === "callout_box");

  return (
    <div className="flex h-full flex-col gap-4 p-5">
      {/* Live Parameter Sliders */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-900/80 p-4 md:grid-cols-3">
        {simulation.params.map((p) => {
          const val = paramValues[p.key] ?? p.default_val;
          return (
            <label key={p.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">{p.name}</span>
                <span className="font-mono text-sky-400">
                  {val.toFixed(2)} {p.unit}
                </span>
              </div>
              <input
                type="range"
                min={p.min_val}
                max={p.max_val}
                step={p.step}
                value={val}
                onChange={(e) => onParamChange(p.key, parseFloat(e.target.value))}
                className="accent-sky-400"
              />
            </label>
          );
        })}
      </div>

      {/* Interactive SVG Plot */}
      <div className="relative flex-1 rounded-xl border border-slate-800 bg-slate-950 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-200">{simulation.paper_title}</p>
            <p className="font-mono text-[11px] text-slate-400">
              ODE: θ̈(t) + γθ̇(t) + η∇L(θ(t)) = 0
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {simulation.series.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </div>
            ))}
          </div>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="h-[calc(100%-3rem)] w-full">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const yPos = pad.top + t * plotH;
            const yVal = maxY - t * ySpan;
            return (
              <g key={t}>
                <line x1={pad.left} y1={yPos} x2={width - pad.right} y2={yPos} stroke="#1e293b" strokeWidth="1" />
                <text x={pad.left - 8} y={yPos + 4} textAnchor="end" fill="#64748b" fontSize="10">
                  {yVal.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Zero line */}
          {minY < 0 && maxY > 0 && (
            <line
              x1={pad.left}
              y1={toSvgY(0)}
              x2={width - pad.right}
              y2={toSvgY(0)}
              stroke="#475569"
              strokeDasharray="4 4"
            />
          )}

          {/* Series curves */}
          {simulation.series.map((s) => {
            const d = xs
              .map((x, idx) => `${idx === 0 ? "M" : "L"} ${toSvgX(x).toFixed(1)} ${toSvgY(s.y[idx] ?? 0).toFixed(1)}`)
              .join(" ");
            return (
              <path
                key={s.name}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            );
          })}

          {/* Axis labels */}
          <text x={width / 2} y={height - 6} textAnchor="middle" fill="#94a3b8" fontSize="11">
            {simulation.x_label}
          </text>
        </svg>

        {/* Avatar Callout Annotations */}
        {callouts.map((c, idx) => (
          <div
            key={idx}
            style={{ left: Math.min(c.x ?? 220, 460), top: Math.min(c.y ?? 100, 220) }}
            className="pointer-events-none absolute z-10 rounded-md border border-amber-400 bg-amber-950/90 px-2.5 py-1 text-xs font-medium text-amber-200 shadow-lg"
          >
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}
