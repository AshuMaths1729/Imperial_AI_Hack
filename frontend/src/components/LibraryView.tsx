"use client";

import React from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Clock,
  FileText,
  GitCompare,
  GraduationCap,
  Layers,
  Link2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { WorkspaceDataset, WorkspaceMode } from "../types/scholartwin";
import { NewConversationPanel } from "./UploadModal";

export interface LibraryTopic {
  id: string;
  title: string;
  subtitle: string;
  mode: WorkspaceMode;
  sourceLabel: string;
  sourceType: "pdf" | "url" | "preset";
  updatedAt: string;
  lastReply: string;
  dataset?: WorkspaceDataset;
}

interface LibraryViewProps {
  mode: "lecture" | "paper2sim";
  topics: LibraryTopic[];
  uploadLoading: boolean;
  uploadError: string | null;
  onBackHome: () => void;
  onOpenTopic: (topic: LibraryTopic) => void;
  onDeleteTopic: (id: string) => void;
  onUploadPdf: (file: File) => void;
  onIngestUrl: (url: string) => void;
}

const MODE_META: Record<
  WorkspaceMode,
  { label: string; icon: React.ComponentType<{ className?: string }>; badgeClass: string }
> = {
  lecture: {
    label: "LectureUnderstanding",
    icon: Layers,
    badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  },
  paper2sim: {
    label: "PaperSim",
    icon: Activity,
    badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  hypothesis: {
    label: "HypothesisGraph",
    icon: GitCompare,
    badgeClass: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  },
};

const COPY = {
  lecture: {
    title: "LectureUnderstanding",
    tagline: "Turn any lecture into a living concept map.",
    desc: "Upload a lecture PDF or paste a URL to open the avatar & canvas workspace.",
    dropHint: "Drop a lecture PDF here, or click to browse",
    dropSubHint: "Extracts slides into a clickable concept graph",
  },
  paper2sim: {
    title: "PaperSim",
    tagline: "Bring a paper's equations to life.",
    desc: "Upload a paper PDF or paste an arXiv link to build tabbed interactive simulations.",
    dropHint: "Drop a paper PDF here, or click to browse",
    dropSubHint: "Extracts the model into interactive, tweakable visualisations",
  },
} as const;

function formatTopicDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Recent";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function LibraryView({
  mode,
  topics,
  uploadLoading,
  uploadError,
  onBackHome,
  onOpenTopic,
  onDeleteTopic,
  onUploadPdf,
  onIngestUrl,
}: LibraryViewProps) {
  const copy = COPY[mode];

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Ambient animated backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="st-aurora absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-sky-500/15 blur-3xl" />
        <div className="st-aurora-slow absolute top-56 -left-40 h-[380px] w-[380px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="st-aurora-slow absolute top-96 -right-32 h-[340px] w-[340px] rounded-full bg-purple-500/10 blur-3xl" />
        <div className="st-grid absolute inset-0 opacity-[0.15]" />
      </div>

      {/* Top Bar */}
      <header className="st-fade-down relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="group flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-500/60 hover:text-sky-300"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            Home
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <Sparkles className="st-twinkle h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100">{copy.title}</h1>
            <p className="text-[11px] text-slate-400">ScholarTwin Library</p>
          </div>
        </div>

        <a
          href="/tutor"
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
        >
          <GraduationCap className="h-3.5 w-3.5" />
          Live Tutor
        </a>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-6 pb-16 pt-10">
        {/* Hero: centred New Conversation panel */}
        <section className="mx-auto max-w-xl">
          <div className="st-fade-up mb-6 text-center" style={{ animationDelay: "60ms" }}>
            <h2 className="bg-gradient-to-r from-sky-300 via-slate-100 to-emerald-300 bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
              {copy.tagline}
            </h2>
            <p className="mt-2 text-sm text-slate-400">{copy.desc}</p>
          </div>
          <div className="st-fade-up st-pop" style={{ animationDelay: "160ms" }}>
            <NewConversationPanel
              variant="hero"
              loading={uploadLoading}
              error={uploadError}
              onUploadPdf={onUploadPdf}
              onIngestUrl={onIngestUrl}
              dropHint={copy.dropHint}
              dropSubHint={copy.dropSubHint}
            />
          </div>
        </section>

        {/* Library */}
        <section className="mt-14">
          <div
            className="st-fade-up mb-5 flex items-center gap-3"
            style={{ animationDelay: "260ms" }}
          >
            <BookOpen className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold tracking-tight text-slate-100">
              Your {copy.title} Library
            </h3>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-400">
              {topics.length}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-slate-800 to-transparent" />
          </div>

          {topics.length === 0 ? (
            <div
              className="st-fade-up flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-14 text-center"
              style={{ animationDelay: "320ms" }}
            >
              <BookOpen className="st-bob mb-3 h-8 w-8 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">No conversations yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Start one above by uploading a PDF or pasting a URL.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((topic, idx) => {
                const meta = MODE_META[topic.mode];
                const ModeIcon = meta.icon;
                return (
                  <div
                    key={topic.id}
                    onClick={() => onOpenTopic(topic)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenTopic(topic);
                      }
                    }}
                    style={{ animationDelay: `${320 + idx * 70}ms` }}
                    className="st-fade-up st-sheen group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-sky-500/60 hover:bg-slate-900 hover:shadow-xl hover:shadow-sky-500/10 focus-visible:-translate-y-1 focus-visible:border-sky-500 focus-visible:outline-none"
                  >
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
                        >
                          <ModeIcon className="h-3 w-3" />
                          {meta.label}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Remove ${topic.title}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTopic(topic.id);
                            }}
                            className="rounded-md p-1 text-slate-500 opacity-0 transition hover:bg-slate-800 hover:text-rose-400 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <ArrowUpRight className="h-4 w-4 -translate-x-1 translate-y-1 text-sky-400 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" />
                        </div>
                      </div>

                      <h3 className="line-clamp-1 text-sm font-semibold text-slate-100 transition-colors group-hover:text-sky-300">
                        {topic.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{topic.subtitle}</p>
                      <p className="mt-3 line-clamp-2 rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2 text-[11px] text-slate-400 transition-colors group-hover:border-slate-700">
                        {topic.lastReply}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-[11px] text-slate-500">
                      <span className="flex max-w-[65%] items-center gap-1 truncate">
                        {topic.sourceType === "pdf" ? (
                          <FileText className="h-3 w-3 shrink-0 text-sky-400" />
                        ) : topic.sourceType === "url" ? (
                          <Link2 className="h-3 w-3 shrink-0 text-emerald-400" />
                        ) : (
                          <Sparkles className="h-3 w-3 shrink-0 text-purple-400" />
                        )}
                        <span className="truncate">{topic.sourceLabel}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTopicDate(topic.updatedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
