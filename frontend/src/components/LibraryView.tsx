"use client";

import React from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Clock,
  FileText,
  GitCompare,
  Layers,
  Link2,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { WorkspaceDataset, WorkspaceMode } from "../types/scholartwin";
import { NewConversationPanel } from "./UploadModal";
import { AppHeader } from "./AppHeader";

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
  {
    label: string;
    icon: LucideIcon;
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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Ambient animated backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="apple-hero-glow absolute inset-x-0 top-0 h-[520px]" />
        <div className="st-aurora absolute -top-40 left-[calc(50%-410px)] h-[520px] w-[820px] rounded-full bg-[var(--accent-soft)] blur-3xl" />
        <div className="st-aurora-slow absolute top-56 -left-40 h-[380px] w-[380px] rounded-full bg-[var(--status-support-soft)] blur-3xl" />
        <div className="st-aurora-slow absolute top-96 -right-32 h-[340px] w-[340px] rounded-full bg-[var(--status-gap-soft)] blur-3xl" />
        <div className="st-grid absolute inset-0 opacity-[0.35]" />
      </div>

      <AppHeader
        sticky
        tone={mode === "paper2sim" ? "support" : "accent"}
        back={{ label: "Home", onClick: onBackHome }}
        icon={MODE_META[mode].icon}
        title={copy.title}
        subtitle="ScholarTwin Library"
      />

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-6 pb-16 pt-10">
        {/* Hero: centred New Conversation panel */}
        <section className="mx-auto max-w-xl">
          <div className="st-fade-up mb-6 text-center" style={{ animationDelay: "60ms" }}>
            {/* leading/padding leave room for descenders, which bg-clip-text would otherwise cut */}
            <h2 className="apple-display bg-gradient-to-r from-[var(--accent)] via-[var(--text-primary)] to-[var(--status-support)] bg-clip-text pb-1.5 text-2xl font-bold !leading-[1.25] text-transparent sm:text-3xl">
              {copy.tagline}
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{copy.desc}</p>
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
          <div className="st-fade-up mb-5 flex items-center gap-3" style={{ animationDelay: "260ms" }}>
            <BookOpen className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
              Your {copy.title} Library
            </h3>
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
              {topics.length}
            </span>
            <div className="h-px flex-1 bg-gradient-to-r from-[var(--border-strong)] to-transparent" />
          </div>

          {topics.length === 0 ? (
            <div
              className="st-fade-up flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] px-6 py-14 text-center"
              style={{ animationDelay: "320ms" }}
            >
              <BookOpen className="st-bob mb-3 h-8 w-8 text-[var(--text-muted)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">No conversations yet</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
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
                    className="apple-card apple-focus st-fade-up st-sheen group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-subtle)] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--accent-border)] focus-visible:-translate-y-1 active:scale-[0.98]"
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
                        <div className="flex items-center gap-1">
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
                          <ArrowUpRight className="h-4 w-4 -translate-x-1 translate-y-1 text-[var(--accent)] opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100" />
                        </div>
                      </div>

                      <h3 title={topic.title} className="line-clamp-1 text-sm font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--accent)]">
                        {topic.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">
                        {topic.subtitle}
                      </p>
                      <p className="mt-3 line-clamp-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-2 text-[11px] text-[var(--text-muted)] transition-colors group-hover:border-[var(--border-strong)]">
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
                        <span title={topic.sourceLabel} className="truncate">{topic.sourceLabel}</span>
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
