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

interface HomeHubProps {
  onSelectMode: (mode: WorkspaceMode) => void;
}

const OPTIONS: {
  mode: WorkspaceMode;
  title: string;
  tagline: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  badge: string;
}[] = [
  {
    mode: "lecture",
    title: "LectureUnderstanding",
    tagline: "Interactive Concept Graph & Avatar Tutor",
    description:
      "Browse your saved lecture conversations or upload a lecture PDF/URL to explore prerequisite concepts in a 2-pane avatar & canvas workspace.",
    icon: Layers,
    accent: "border-sky-500/40 hover:border-sky-400 hover:shadow-sky-500/10",
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  {
    mode: "paper2sim",
    title: "PaperSim",
    tagline: "Multi-Tab Interactive Visualisations",
    description:
      "Open saved paper simulations or ingest a paper PDF/URL to generate tabbed interactive plots, concept maps, and runnable equation models.",
    icon: Activity,
    accent: "border-emerald-500/40 hover:border-emerald-400 hover:shadow-emerald-500/10",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  {
    mode: "hypothesis",
    title: "HypothesisGraph",
    tagline: "Grounded Multi-Paper Research Chatbot",
    description:
      "Ask a research question by text or voice to search arXiv, bioRxiv, and PubMed and map supporting evidence, contradictions, and research gaps.",
    icon: GitCompare,
    accent: "border-purple-500/40 hover:border-purple-400 hover:shadow-purple-500/10",
    badge: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  },
];

export function HomeHub({ onSelectMode }: HomeHubProps) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100">ScholarTwin</h1>
            <p className="text-[11px] text-slate-400">Spatial AI Research & Learning Workspace</p>
          </div>
        </div>

        <a
          href="/tutor"
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600"
        >
          <GraduationCap className="h-3.5 w-3.5" />
          Live Tutor
        </a>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-10 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] font-medium text-sky-300">
            <Sparkles className="h-3 w-3" />
            Choose a Workspace
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            What would you like to explore?
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">
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
                className={`group flex flex-col justify-between rounded-2xl border bg-slate-900/75 p-6 text-left shadow-xl transition hover:-translate-y-0.5 hover:bg-slate-900 ${opt.accent}`}
              >
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <span
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${opt.badge}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-1 group-hover:text-slate-200" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-100">{opt.title}</h3>
                  <p className="mt-1 text-xs font-medium text-slate-300">{opt.tagline}</p>
                  <p className="mt-3 text-xs leading-relaxed text-slate-400">{opt.description}</p>
                </div>

                <div className="mt-6 flex items-center gap-1.5 text-xs font-semibold text-sky-400 group-hover:text-sky-300">
                  Open {opt.title}
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
