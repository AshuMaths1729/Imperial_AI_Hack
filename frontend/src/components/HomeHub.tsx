"use client";

import React from "react";
import {
  Activity,
  ArrowRight,
  GitCompare,
  GraduationCap,
  Layers,
  Sparkles,
} from "lucide-react";
import { WorkspaceMode } from "../types/scholartwin";
import { ThemeToggle } from "./ThemeProvider";

interface HomeHubProps {
  onSelectMode: (mode: WorkspaceMode) => void;
}

const OPTIONS: {
  mode: WorkspaceMode;
  title: string;
  tagline: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
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
    <div className="apple-hero-glow flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <header className="apple-glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="apple-heading text-sm font-bold text-[var(--text-primary)]">ScholarTwin</h1>
            <p className="text-[11px] text-[var(--text-muted)]">Spatial AI Research & Learning Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href="/tutor"
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <GraduationCap className="h-3.5 w-3.5 text-[var(--accent)]" />
            Live Tutor
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-10 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--accent)]">
            <Sparkles className="h-3 w-3" />
            Choose a Workspace
          </span>
          <h2 className="apple-display mt-4 text-3xl font-bold text-[var(--text-primary)] sm:text-4xl">
            What would you like to explore?
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-[var(--text-secondary)]">
            Select a workflow to understand lectures, simulate paper equations, or map grounded
            hypotheses across scientific literature.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => onSelectMode(opt.mode)}
                style={{
                  borderColor: opt.borderVar,
                }}
                className="apple-card apple-press apple-focus group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-6 text-left hover:-translate-y-0.5"
              >
                <div
                  aria-hidden
                  style={{ backgroundColor: opt.accentVar }}
                  className="absolute inset-x-0 top-0 h-1 opacity-85"
                />
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span
                      style={{
                        backgroundColor: opt.softVar,
                        color: opt.accentVar,
                        borderColor: opt.borderVar,
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border"
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-[var(--text-muted)] transition-transform duration-150 group-hover:translate-x-1 group-hover:text-[var(--text-primary)]" />
                  </div>
                  <h3 className="apple-heading text-lg font-semibold text-[var(--text-primary)]">
                    {opt.title}
                  </h3>
                  <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{opt.tagline}</p>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{opt.description}</p>
                </div>

                <div
                  style={{ color: opt.accentVar }}
                  className="mt-6 flex items-center gap-1.5 text-xs font-semibold"
                >
                  Open {opt.title}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
