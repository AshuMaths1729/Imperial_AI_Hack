"use client";

import React from "react";
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Clock,
  FileText,
  GitCompare,
  GraduationCap,
  Layers,
  Link2,
  MessageSquarePlus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { WorkspaceDataset, WorkspaceMode } from "../types/scholartwin";

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
  onBackHome: () => void;
  onOpenTopic: (topic: LibraryTopic) => void;
  onDeleteTopic: (id: string) => void;
  onNewConversation: () => void;
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
  onBackHome,
  onOpenTopic,
  onDeleteTopic,
  onNewConversation,
}: LibraryViewProps) {
  const modeTitle = mode === "lecture" ? "LectureUnderstanding" : "PaperSim";
  const modeDesc =
    mode === "lecture"
      ? "Reopen a previous lecture conversation or upload a new lecture PDF/URL for the 2-pane avatar & canvas."
      : "Reopen a previous paper simulation or upload a paper PDF/URL to build tabbed interactive visualisations.";

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-sky-500/60 hover:text-sky-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Home
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100">{modeTitle}</h1>
            <p className="text-[11px] text-slate-400">ScholarTwin Library</p>
          </div>
        </div>

        {/* Navigation Tabs: Library + New Conversation */}
        <nav className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Library
          </button>
          <button
            type="button"
            onClick={onNewConversation}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-sky-300"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-sky-400" />
            New Conversation
          </button>
        </nav>

        <a
          href="/tutor"
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600"
        >
          <GraduationCap className="h-3.5 w-3.5" />
          Live Tutor
        </a>
      </header>

      {/* Library Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-100">
              {modeTitle} Library
            </h2>
            <p className="mt-1 text-xs text-slate-400">{modeDesc}</p>
          </div>
          <button
            type="button"
            onClick={onNewConversation}
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-sm shadow-sky-500/20 transition hover:bg-sky-400"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New Conversation
          </button>
        </div>

        {topics.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
            <BookOpen className="mb-3 h-8 w-8 text-slate-600" />
            <p className="text-sm font-medium text-slate-300">No conversations yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Start a new conversation by uploading a PDF or pasting a URL.
            </p>
            <button
              type="button"
              onClick={onNewConversation}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              New Conversation
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic) => {
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
                  className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-sky-500/60 hover:bg-slate-900"
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
                      >
                        <ModeIcon className="h-3 w-3" />
                        {meta.label}
                      </span>
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
                    </div>

                    <h3 className="line-clamp-1 text-sm font-semibold text-slate-100 group-hover:text-sky-300">
                      {topic.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{topic.subtitle}</p>
                    <p className="mt-3 line-clamp-2 rounded-lg border border-slate-800/80 bg-slate-950/60 px-2.5 py-2 text-[11px] text-slate-400">
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
                    <span className="flex items-center gap-1 shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatTopicDate(topic.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
