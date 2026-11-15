"use client";

import React, { useMemo } from "react";
import { FileText, Link2, Sparkles, type LucideIcon } from "lucide-react";
import { WorkspaceDataset, WorkspaceMode } from "../types/scholartwin";
import { MODULES } from "../modules";
import { dedupeTopics, fullDate, paperSource, relativeTime, sliderCount, useNow } from "../lib/recent";
import { OpenPaperPanel } from "./UploadModal";
import { AppHeader } from "./AppHeader";
import { RecentRow } from "./home/RecentRow";

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
  /** Only the Paper Simulator has a library: Live Lessons is its own route (/lecture/lesson). */
  mode: "paper2sim";
  topics: LibraryTopic[];
  uploadLoading: boolean;
  uploadError: string | null;
  onBackHome: () => void;
  onOpenTopic: (topic: LibraryTopic) => void;
  onDeleteTopic: (id: string) => void;
  onUploadPdf: (file: File) => void;
  onIngestUrl: (url: string) => void;
}

const SOURCE_ICON: Record<LibraryTopic["sourceType"], LucideIcon> = {
  pdf: FileText,
  url: Link2,
  preset: Sparkles,
};

/** The paper's second line: the model it simulates (else its summary), sliders and source. */
function paperDetail(topic: LibraryTopic): string {
  const sim = topic.dataset?.simulation;
  const model = sim?.sim_title && sim.sim_title !== topic.title ? sim.sim_title : "";
  const n = sliderCount(topic.dataset);
  const sliders = n ? `${n} slider${n === 1 ? "" : "s"}` : "";
  return [model || (!sliders ? topic.subtitle : ""), sliders, paperSource(topic)].filter(Boolean).join(" · ");
}

/**
 * The Paper Simulator start screen: open a paper (drop a PDF or paste an arXiv link), or pick
 * one you opened before.
 */
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
  const mod = MODULES[mode];
  const now = useNow();
  // The same paper is listed once (page.tsx also dedupes when saving).
  const papers = useMemo(() => dedupeTopics(topics), [topics]);

  return (
    // Transparent root so the landscape shows through. The module hue flows into the panel
    // (its icon, drop zone and Open button read --tint).
    <div
      className="relative flex min-h-screen flex-col overflow-x-clip text-[var(--text-primary)]"
      style={{ "--tint": mod.hue } as React.CSSProperties}
    >
      <AppHeader sticky tone={mod.tone} back={{ label: "Home", onClick: onBackHome }} icon={mod.icon} title={mod.name} />

      <main className="relative mx-auto w-full max-w-[1180px] flex-1 px-4 pb-16 sm:px-6">
        <div className="st-fade-up grid gap-2.5 px-1 pb-7 pt-10 sm:pb-8 sm:pt-14">
          <span className="on-scene font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.12em]">
            {mod.verb}
          </span>
          {/* h2: the header capsule's title is the page's h1 (same words). */}
          <h2 className="st-display on-scene text-[clamp(38px,5.4vw,62px)]">{mod.name}</h2>
          <p className="on-scene max-w-[620px] text-[16.5px] font-[450] leading-relaxed">{mod.description}</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-5">
          <section aria-label="Open a paper" className="st-fade-up min-w-0" style={{ animationDelay: "80ms" }}>
            <OpenPaperPanel
              variant="hero"
              loading={uploadLoading}
              error={uploadError}
              onUploadPdf={onUploadPdf}
              onIngestUrl={onIngestUrl}
            />
          </section>

          <section aria-labelledby="papers-heading" className="st-fade-up min-w-0" style={{ animationDelay: "160ms" }}>
            <div className="mb-3 flex items-baseline justify-between gap-3 px-1 lg:mt-1">
              <h2 id="papers-heading" className="on-scene text-[clamp(24px,2.6vw,28px)] font-normal leading-tight tracking-[-0.025em]">
                Your papers
              </h2>
              <span className="on-scene font-mono text-[12px] tabular-nums">
                {papers.length} {papers.length === 1 ? "paper" : "papers"}
              </span>
            </div>

            {papers.length === 0 ? (
              <div className="apple-sheet flex flex-col items-center gap-2 rounded-[26px] border-dashed! border-[var(--border-strong)]! px-6 py-12 text-center">
                <FileText aria-hidden className="st-bob mb-1 h-8 w-8 text-[var(--text-muted)]" />
                <p className="text-[15px] font-medium text-[var(--text-primary)]">No papers yet</p>
                <p className="max-w-xs text-[13.5px] text-[var(--text-secondary)]">
                  Open one by dropping a PDF or pasting an arXiv link, and it will be saved here.
                </p>
              </div>
            ) : (
              <div className="apple-sheet rounded-[26px] p-1.5">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {papers.map((topic) => (
                    <RecentRow
                      key={topic.id}
                      icon={SOURCE_ICON[topic.sourceType] ?? FileText}
                      hue={mod.hue}
                      title={topic.title}
                      detail={paperDetail(topic)}
                      when={now ? relativeTime(topic.updatedAt, now) : ""}
                      whenTitle={fullDate(topic.updatedAt)}
                      dateTime={topic.updatedAt}
                      onOpen={() => onOpenTopic(topic)}
                      onDelete={() => onDeleteTopic(topic.id)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
