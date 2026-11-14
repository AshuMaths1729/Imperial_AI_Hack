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
import { ThemeToggle } from "./ThemeProvider";

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
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    colorVar: string;
    softVar: string;
    borderVar: string;
  }
> = {
  lecture: {
    label: "LectureUnderstanding",
    icon: Layers,
    colorVar: "var(--accent)",
    softVar: "var(--accent-soft)",
    borderVar: "var(--accent-border)",
  },
  paper2sim: {
    label: "PaperSim",
    icon: Activity,
    colorVar: "var(--status-support)",
    softVar: "var(--status-support-soft)",
    borderVar: "var(--status-support-border)",
  },
  hypothesis: {
    label: "HypothesisGraph",
    icon: GitCompare,
    colorVar: "var(--status-gap)",
    softVar: "var(--status-gap-soft)",
    borderVar: "var(--status-gap-border)",
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
    <div className="flex min-h-screen flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Top Bar */}
      <header className="apple-glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackHome}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Home
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="apple-heading text-sm font-bold text-[var(--text-primary)]">{modeTitle}</h1>
            <p className="text-[11px] text-[var(--text-muted)]">ScholarTwin Library</p>
          </div>
        </div>

        {/* Navigation Segmented Control: Library + New Conversation */}
        <nav className="flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-1">
          <button
            type="button"
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-fg)] shadow-sm"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Library
          </button>
          <button
            type="button"
            onClick={onNewConversation}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--accent)]"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--accent)]" />
            New Conversation
          </button>
        </nav>

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

      {/* Library Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="apple-heading text-2xl font-bold text-[var(--text-primary)]">
              {modeTitle} Library
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{modeDesc}</p>
          </div>
          <button
            type="button"
            onClick={onNewConversation}
            className="apple-press apple-focus flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--accent-fg)] shadow-sm hover:bg-[var(--accent-hover)]"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New Conversation
          </button>
        </div>

        {topics.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-16 text-center">
            <BookOpen className="mb-3 h-8 w-8 text-[var(--text-muted)]" />
            <p className="text-sm font-medium text-[var(--text-primary)]">No conversations yet</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Start a new conversation by uploading a PDF or pasting a URL.
            </p>
            <button
              type="button"
              onClick={onNewConversation}
              className="apple-press apple-focus mt-4 flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
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
                  className="apple-press apple-focus group relative flex cursor-pointer flex-col justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:shadow-md"
                >
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span
                        style={{
                          color: meta.colorVar,
                          backgroundColor: meta.softVar,
                          borderColor: meta.borderVar,
                        }}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold"
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
                        className="apple-focus rounded-md p-1 text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--status-contradict-soft)] hover:text-[var(--status-contradict)] group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <h3 className="line-clamp-1 text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                      {topic.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{topic.subtitle}</p>
                    <p className="mt-3 line-clamp-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
                      {topic.lastReply}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-[11px] text-[var(--text-muted)]">
                    <span className="flex max-w-[65%] items-center gap-1.5 truncate">
                      {topic.sourceType === "pdf" ? (
                        <FileText className="h-3 w-3 shrink-0 text-[var(--accent)]" />
                      ) : topic.sourceType === "url" ? (
                        <Link2 className="h-3 w-3 shrink-0 text-[var(--status-support)]" />
                      ) : (
                        <Sparkles className="h-3 w-3 shrink-0 text-[var(--status-gap)]" />
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
      </main>
    </div>
  );
}
