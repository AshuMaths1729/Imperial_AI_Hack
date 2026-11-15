"use client";

import React from "react";
import { Activity, ArrowRight, GitCompare, Layers, Sparkles, type LucideIcon } from "lucide-react";
import { WorkspaceMode } from "../types/scholartwin";
import { AppHeader } from "./AppHeader";

interface HomeHubProps {
  onSelectMode: (mode: WorkspaceMode) => void;
}

const OPTIONS: {
  mode: WorkspaceMode;
  title: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  accentVar: string;
  softVar: string;
  borderVar: string;
}[] = [
  {
    mode: "lecture",
    title: "LectureUnderstanding",
    tagline: "Interactive Concept Graph & Avatar Tutor",
    description:
      "Browse your saved lecture conversations or upload a lecture PDF/URL to explore prerequisite concepts in a 2-pane avatar & canvas workspace.",
    icon: Layers,
    accentVar: "var(--accent)",
    softVar: "var(--accent-soft)",
    borderVar: "var(--accent-border)",
  },
  {
    mode: "paper2sim",
    title: "PaperSim",
    tagline: "Multi-Tab Interactive Visualisations",
    description:
      "Open saved paper simulations or ingest a paper PDF/URL to generate tabbed interactive plots, concept maps, and runnable equation models.",
    icon: Activity,
    accentVar: "var(--status-support)",
    softVar: "var(--status-support-soft)",
    borderVar: "var(--status-support-border)",
  },
  {
    mode: "hypothesis",
    title: "HypothesisGraph",
    tagline: "Grounded Multi-Paper Research Chatbot",
    description:
      "Ask a research question by text or voice to search arXiv, bioRxiv, and PubMed and map supporting evidence, contradictions, and research gaps.",
    icon: GitCompare,
    accentVar: "var(--status-gap)",
    softVar: "var(--status-gap-soft)",
    borderVar: "var(--status-gap-border)",
  },
];

export function HomeHub({ onSelectMode }: HomeHubProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Ambient animated backdrop, one glow per workspace hue */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="apple-hero-glow absolute inset-x-0 top-0 h-[560px]" />
        <div className="st-aurora absolute -top-48 left-[calc(50%-440px)] h-[560px] w-[880px] rounded-full bg-[var(--accent-soft)] blur-3xl" />
        <div className="st-aurora-slow absolute top-72 -left-40 h-[400px] w-[400px] rounded-full bg-[var(--status-support-soft)] blur-3xl" />
        <div className="st-aurora-slow absolute top-80 -right-36 h-[380px] w-[380px] rounded-full bg-[var(--status-gap-soft)] blur-3xl" />
        <div className="st-grid absolute inset-0 opacity-[0.35]" />
      </div>

      {/* The bar keeps only the global controls: the name lives in the hero below. */}
      <AppHeader sticky />

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12">
        <div className="my-auto">
          {/* Hero: the product name, front and centre */}
          <section className="mb-12 text-center">
            <div className="st-fade-up mx-auto mb-5 flex w-fit items-center justify-center" style={{ animationDelay: "40ms" }}>
              <span className="st-float relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--accent-border)] bg-[var(--bg-surface)] shadow-lg">
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-2xl opacity-60 blur-xl"
                  style={{
                    background:
                      "conic-gradient(from 180deg, var(--accent), var(--status-support), var(--status-gap), var(--accent))",
                  }}
                />
                <span className="relative flex h-full w-full items-center justify-center rounded-2xl bg-[var(--bg-surface)]">
                  <Sparkles className="st-twinkle h-7 w-7 text-[var(--accent)]" />
                </span>
              </span>
            </div>

            {/* Two elements: st-fade-up and st-pan each set `animation`, so they can't share one. */}
            <div className="st-fade-up" style={{ animationDelay: "120ms" }}>
              <h1
                className="apple-display st-pan bg-clip-text pb-2 text-5xl font-bold !leading-[1.15] tracking-tight text-transparent sm:text-7xl"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, var(--accent), var(--status-support), var(--status-gap), var(--accent))",
                }}
              >
                ScholarTwin
              </h1>
            </div>
            <p
              className="st-fade-up mx-auto mt-3 max-w-2xl text-base text-[var(--text-secondary)] sm:text-lg"
              style={{ animationDelay: "200ms" }}
            >
              Your spatial AI workspace for research and learning: understand lectures, run a paper&apos;s
              equations, and map what the literature agrees and disagrees on.
            </p>
          </section>

          <div className="st-fade-up mb-5 flex items-center gap-3" style={{ animationDelay: "280ms" }}>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--border-strong)]" />
            <h2 className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
              Choose a workspace
            </h2>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[var(--border-strong)]" />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {OPTIONS.map((opt, i) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => onSelectMode(opt.mode)}
                  style={
                    {
                      animationDelay: `${340 + i * 90}ms`,
                      "--card-c": opt.accentVar,
                      "--card-b": opt.borderVar,
                    } as React.CSSProperties
                  }
                  className="apple-card apple-focus st-fade-up st-sheen group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-subtle)] p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:border-[var(--card-b)] hover:shadow-xl focus-visible:-translate-y-1 active:scale-[0.98]"
                >
                  <div
                    aria-hidden
                    style={{ backgroundColor: opt.accentVar }}
                    className="absolute inset-x-0 top-0 h-1 opacity-85 transition-all duration-300 group-hover:h-1.5"
                  />
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <span
                        style={{ backgroundColor: opt.softVar, color: opt.accentVar, borderColor: opt.borderVar }}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <ArrowRight className="h-4 w-4 text-[var(--text-muted)] transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--card-c)]" />
                    </div>
                    <h3 className="apple-heading text-lg font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--card-c)]">
                      {opt.title}
                    </h3>
                    <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{opt.tagline}</p>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{opt.description}</p>
                  </div>

                  <div style={{ color: opt.accentVar }} className="mt-6 flex items-center gap-1.5 text-xs font-semibold">
                    Open {opt.title}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
