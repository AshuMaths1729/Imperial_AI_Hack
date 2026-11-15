"use client";

import React from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import type { WorkspaceDataset } from "@/types/scholartwin";

export type AskTutorTopic = {
  /** Shown as the lesson's topic, e.g. the paper title or the research question. */
  title: string;
  /** What the tutor should teach from. */
  dataset: WorkspaceDataset;
  /** Where it came from, if known (a PDF upload, an arXiv URL, a demo preset). */
  source?: { kind: "pdf" | "url" | "demo"; ref: string };
};

/**
 * "Ask a tutor about this": opens a Live Lesson whose topic is the paper or evidence map on screen.
 * Replaces the old floating LiveTutorFab (which called a retired tutor service).
 *
 * FOUNDATION STUB: the interface is final; the tutor-unification step implements the click
 * (create a learning track from `topic`, then open /lecture/lesson?track=<id>).
 */
export function AskTutorButton({ topic, className = "" }: { topic: AskTutorTopic; className?: string }) {
  return (
    <Link
      href="/lecture/lesson"
      title={`Start a live lesson about ${topic.title}`}
      className={`apple-glass glass-lens apple-press apple-focus relative inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold text-[var(--text-primary)] ${className}`}
    >
      <GraduationCap className="h-4 w-4 text-[var(--accent)]" aria-hidden />
      Ask a tutor about this
    </Link>
  );
}
