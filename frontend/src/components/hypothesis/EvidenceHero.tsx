"use client";

import React, { useEffect, useState } from "react";
import { ArrowUpRight, CircleDashed, Lightbulb, Loader2, ShieldCheck, Swords } from "lucide-react";

/* ------------------------------------------------------------------ animated evidence glyph */

const SUPPORT = "var(--status-support)";
const CONTRADICT = "var(--status-contradict)";
const GAP = "var(--status-gap)";

function Paper({ x, y, color, delay }: { x: number; y: number; color: string; delay: number }) {
  // A tiny "paper" card centred on (x, y).
  return (
    <g className="st-node-in" style={{ animationDelay: `${delay}ms` }}>
      <rect
        x={x - 22}
        y={y - 15}
        width={44}
        height={30}
        rx={6}
        style={{ fill: "var(--bg-surface)", stroke: color, strokeWidth: 1.6 }}
      />
      <rect x={x - 14} y={y - 8} width={20} height={3} rx={1.5} style={{ fill: color, opacity: 0.85 }} />
      <rect x={x - 14} y={y - 1} width={28} height={2.5} rx={1.25} style={{ fill: "var(--text-muted)", opacity: 0.45 }} />
      <rect x={x - 14} y={y + 5} width={22} height={2.5} rx={1.25} style={{ fill: "var(--text-muted)", opacity: 0.45 }} />
    </g>
  );
}

/**
 * A small hypothesis graph that draws itself: one claim, two supporting papers, one
 * contradicting paper and an open research gap. `busy` speeds it up while a search runs.
 */
export function EvidenceGlyph({ busy = false, className = "" }: { busy?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 440 150" role="img" aria-label="Papers supporting, contradicting and leaving gaps around a claim" className={className}>
      {/* edges */}
      <path
        d="M198,68 C152,50 128,36 94,35"
        pathLength={1}
        fill="none"
        className="st-draw"
        style={{ stroke: SUPPORT, strokeWidth: 2.2, strokeLinecap: "round", animationDelay: "250ms" }}
      />
      <path
        d="M198,82 C152,100 128,114 94,115"
        pathLength={1}
        fill="none"
        className="st-draw"
        style={{ stroke: SUPPORT, strokeWidth: 2.2, strokeLinecap: "round", animationDelay: "400ms" }}
      />
      <path
        d="M242,68 C288,50 312,36 346,35"
        pathLength={1}
        fill="none"
        className="st-draw"
        style={{ stroke: CONTRADICT, strokeWidth: 2.2, strokeLinecap: "round", animationDelay: "550ms" }}
      />
      <path
        d="M242,82 C288,100 318,113 352,115"
        fill="none"
        className="st-march"
        style={{ stroke: GAP, strokeWidth: 2, strokeDasharray: "5 3", strokeLinecap: "round" }}
      />

      {/* papers + gap */}
      <Paper x={70} y={35} color={SUPPORT} delay={500} />
      <Paper x={70} y={115} color={SUPPORT} delay={650} />
      <Paper x={370} y={35} color={CONTRADICT} delay={800} />
      <g className="st-node-in" style={{ animationDelay: "950ms" }}>
        <circle cx={370} cy={115} r={15} style={{ fill: "var(--status-gap-soft)", stroke: GAP, strokeWidth: 1.6, strokeDasharray: "4 3" }} />
        <text x={370} y={120} textAnchor="middle" style={{ fill: GAP, fontSize: 14, fontWeight: 700 }}>
          ?
        </text>
      </g>

      {/* the claim */}
      <circle
        cx={220}
        cy={75}
        r={22}
        className={`st-ping ${busy ? "st-ping-fast" : ""}`}
        style={{ fill: "none", stroke: GAP, strokeWidth: 2 }}
      />
      {busy && (
        <circle
          cx={220}
          cy={75}
          r={30}
          className="motion-safe:animate-spin"
          style={{
            fill: "none",
            stroke: GAP,
            strokeWidth: 2,
            strokeDasharray: "18 170",
            strokeLinecap: "round",
            transformBox: "fill-box",
            transformOrigin: "center",
          }}
        />
      )}
      <g className="st-node-in" style={{ animationDelay: "80ms" }}>
        <circle cx={220} cy={75} r={22} style={{ fill: "var(--status-gap-soft)", stroke: GAP, strokeWidth: 2 }} />
        <circle cx={220} cy={75} r={14} style={{ fill: "var(--bg-surface)", stroke: GAP, strokeWidth: 1.2, opacity: 0.9 }} />
        <circle cx={220} cy={75} r={5.5} style={{ fill: GAP }} />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ what you get */

const LEGEND = [
  {
    icon: ShieldCheck,
    title: "Supports",
    body: "Papers whose results back a claim, with the quote that shows it.",
    color: "var(--status-support)",
    soft: "var(--status-support-soft)",
    border: "var(--status-support-border)",
  },
  {
    icon: Swords,
    title: "Contradicts",
    body: "Findings that disagree, laid side by side so you can weigh them.",
    color: "var(--status-contradict)",
    soft: "var(--status-contradict-soft)",
    border: "var(--status-contradict-border)",
  },
  {
    icon: CircleDashed,
    title: "Research gaps",
    body: "Questions the papers leave open: where new work could go.",
    color: "var(--status-gap)",
    soft: "var(--status-gap-soft)",
    border: "var(--status-gap-border)",
  },
] as const;

export function EvidenceLegend({ baseDelay = 0 }: { baseDelay?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {LEGEND.map(({ icon: Icon, title, body, color, soft, border }, i) => (
        <div
          key={title}
          style={{ animationDelay: `${baseDelay + i * 90}ms`, ["--card-c" as string]: color, ["--card-b" as string]: border }}
          className="apple-card st-fade-up group rounded-2xl border p-3.5 transition-all duration-300 hover:-translate-y-1 hover:!border-[var(--card-b)]"
        >
          <div className="flex items-center gap-2">
            <span
              style={{ color, backgroundColor: soft }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold" style={{ color }}>
              {title}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{body}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ starter topics */

export function StarterTopics({
  topics,
  disabled,
  onPick,
  baseDelay = 0,
}: {
  topics: readonly string[];
  disabled?: boolean;
  onPick: (topic: string) => void;
  baseDelay?: number;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {topics.map((q, i) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          style={{ animationDelay: `${baseDelay + i * 70}ms` }}
          className="apple-card apple-press apple-focus st-fade-up group flex max-w-full items-center gap-1.5 rounded-full border py-1.5 pl-3 pr-3.5 text-[11px] text-[var(--text-secondary)] transition-all duration-200 hover:-translate-y-0.5 hover:!border-[var(--status-gap-border)] hover:text-[var(--status-gap)] disabled:pointer-events-none disabled:opacity-50"
        >
          <Lightbulb className="h-3 w-3 shrink-0 text-[var(--status-gap)] transition-transform group-hover:-rotate-12 group-hover:scale-110" />
          <span className="min-w-0 text-left">{q}</span>
          <ArrowUpRight className="h-3 w-3 shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ loading ticker */

const STEPS = [
  "Searching arXiv, bioRxiv, PubMed and Semantic Scholar",
  "Reading abstracts and pulling out quotes",
  "Matching claims across papers",
  "Flagging contradictions and research gaps",
];

/** Mounted only while a search runs, so it restarts from the first step every time. */
export function SearchProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div role="status" aria-live="polite" className="st-fade-up mt-3">
      <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-surface-muted)]">
        <div className="st-progress h-full w-1/3 rounded-full bg-gradient-to-r from-[var(--status-gap)] to-[var(--status-support)]" />
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <Loader2 className="h-3 w-3 animate-spin text-[var(--status-gap)]" />
        <span key={step} className="st-fade-up">
          {STEPS[step]}…
        </span>
        <span className="text-[var(--text-muted)]">
          {step + 1}/{STEPS.length}
        </span>
      </div>
    </div>
  );
}
