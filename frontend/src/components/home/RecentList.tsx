"use client";

import React, { useMemo, useState } from "react";
import type { LibraryTopic } from "../LibraryView";
import { MODULES, MODULE_ORDER } from "../../modules";
import {
  fullDate,
  lessonHref,
  lessonItems,
  mergeRecent,
  paperItems,
  relativeTime,
  useEvidenceTopics,
  useLessonTracks,
  useNow,
  type RecentItem,
} from "../../lib/recent";
import { RecentRow } from "./RecentRow";

/** Rows shown before "Show all". */
const FIRST_ROWS = 6;

export interface RecentListProps {
  /** The Paper Simulator library (page.tsx owns it). */
  papers: LibraryTopic[];
  onOpenPaper: (topic: LibraryTopic) => void;
  onDeletePaper: (id: string) => void;
  /** Opens Evidence Map on this saved topic. */
  onOpenEvidence: (topicId: string) => void;
}

/**
 * "Pick up where you left off": everything the user opened, across the three modules, newest
 * first. Papers come from the library, evidence topics from Evidence Map's saved history (read
 * only) and lessons from the backend's learning tracks (left out when it is unreachable).
 */
export function RecentList({ papers, onOpenPaper, onDeletePaper, onOpenEvidence }: RecentListProps) {
  const evidence = useEvidenceTopics();
  const tracks = useLessonTracks();
  const now = useNow();
  const [showAll, setShowAll] = useState(false);

  const items = useMemo(
    () => mergeRecent(paperItems(papers), evidence, lessonItems(tracks ?? [])),
    [papers, evidence, tracks]
  );
  const topicsById = useMemo(() => new Map(papers.map((t) => [t.id, t])), [papers]);
  const loading = tracks === null && items.length === 0;
  const visible = showAll ? items : items.slice(0, FIRST_ROWS);

  const row = (item: RecentItem) => {
    const mod = MODULES[item.module];
    const common = {
      icon: mod.icon,
      hue: mod.hue,
      title: item.title,
      detail: item.detail ? `${mod.name} · ${item.detail}` : mod.name,
      chip: item.chip,
      when: now ? relativeTime(item.at, now) : "",
      whenTitle: fullDate(item.at),
      dateTime: item.at ?? undefined,
    };
    if (item.module === "lecture") return <RecentRow key={item.key} {...common} href={lessonHref(item.id)} />;
    if (item.module === "hypothesis") return <RecentRow key={item.key} {...common} onOpen={() => onOpenEvidence(item.id)} />;
    const topic = topicsById.get(item.id);
    return (
      <RecentRow
        key={item.key}
        {...common}
        onOpen={() => topic && onOpenPaper(topic)}
        onDelete={() => onDeletePaper(item.id)}
      />
    );
  };

  return (
    <section aria-labelledby="recent-heading" className="mt-12 sm:mt-14">
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
        <h2 id="recent-heading" className="on-scene text-[clamp(26px,3vw,32px)] font-normal leading-tight tracking-[-0.025em] [text-wrap:balance]">
          Pick up <span className="on-scene-soft">where you left off.</span>
        </h2>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading your recent items" className="apple-sheet rounded-[26px] p-1.5">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3.5 px-3.5 py-3">
              <span className="h-[34px] w-[34px] shrink-0 animate-pulse rounded-[11px] bg-[var(--bg-surface-muted)]" />
              <span className="grid flex-1 gap-2">
                <span className="h-3.5 w-2/5 animate-pulse rounded-full bg-[var(--bg-surface-muted)]" />
                <span className="h-3 w-1/4 animate-pulse rounded-full bg-[var(--bg-surface-muted)]" />
              </span>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyRecent />
      ) : (
        <div className="apple-sheet rounded-[26px] p-1.5">
          <ul className="divide-y divide-[var(--border-subtle)]">{visible.map(row)}</ul>
          {items.length > FIRST_ROWS && (
            <div className="flex justify-center border-t border-[var(--border-subtle)] pt-1.5">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="apple-press apple-focus rounded-full px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
              >
                {showAll ? "Show fewer" : `Show all ${items.length}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Nothing saved yet: say what will appear here, in each module's colour. */
function EmptyRecent() {
  return (
    <div className="apple-sheet flex flex-col items-center gap-3 rounded-[26px] border-dashed! border-[var(--border-strong)]! px-6 py-10 text-center">
      <div aria-hidden className="flex -space-x-2">
        {MODULE_ORDER.map((id) => {
          const Icon = MODULES[id].icon;
          return (
            <span
              key={id}
              className="grid h-10 w-10 place-items-center rounded-[13px] border-2 border-[var(--bg-surface-solid)]"
              style={{ backgroundColor: MODULES[id].hue, color: "var(--accent-fg)" }}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </span>
          );
        })}
      </div>
      <p className="text-[15px] font-medium text-[var(--text-primary)]">Nothing to pick up yet</p>
      <p className="max-w-sm text-[13.5px] text-[var(--text-secondary)]">
        Lessons you take, papers you open and questions you map will wait for you here.
      </p>
    </div>
  );
}
