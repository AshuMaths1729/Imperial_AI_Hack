"use client";

import { ConfirmDelete } from "@/components/glass/ConfirmDelete";
import React from "react";
import Link from "next/link";
import { type LucideIcon } from "lucide-react";

export type RecentRowProps = {
  icon: LucideIcon;
  /** Module hue token for the icon tile, e.g. "var(--status-support)". */
  hue: string;
  title: string;
  /** Second line, e.g. "Paper Simulator · 4 sliders". */
  detail: React.ReactNode;
  chip?: string;
  /** Relative time shown on the right, with the full date as a tooltip. */
  when?: string;
  whenTitle?: string;
  dateTime?: string;
  /** Opens the item: a link (another route) or a callback (a screen on this page). */
  href?: string;
  onOpen?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
};

const OPEN =
  "apple-focus flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-3 py-2.5 text-left text-[var(--text-primary)] sm:gap-3.5 sm:px-3.5 sm:py-3";

/**
 * One row of a recent list: module icon tile in its hue, title, detail line, an optional chip,
 * the relative time and an optional delete button (a sibling of the open control, never inside it).
 */
export function RecentRow({
  icon: Icon,
  hue,
  title,
  detail,
  chip,
  when,
  whenTitle,
  dateTime,
  href,
  onOpen,
  onDelete,
  deleteLabel,
}: RecentRowProps) {
  const body = (
    <>
      <span
        aria-hidden
        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] shadow-[inset_0_1px_0_var(--glass-rim)]"
        style={{ backgroundColor: hue, color: "var(--accent-fg)" }}
      >
        <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        {/* Two lines on phones (the time and delete take the right edge), one line from sm. */}
        <span
          title={title}
          className="line-clamp-2 text-[15px] font-medium leading-snug [overflow-wrap:anywhere] sm:line-clamp-none sm:block sm:truncate"
        >
          {title}
        </span>
        <span className="block truncate text-[13px] leading-snug text-[var(--text-secondary)]">{detail}</span>
      </span>
      {chip && (
        <span
          title={chip}
          className="hidden max-w-[9rem] shrink-0 truncate whitespace-nowrap rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 font-mono text-[11.5px] font-medium leading-none text-[var(--text-secondary)] sm:inline-block"
        >
          {chip}
        </span>
      )}
      {when && (
        <time
          dateTime={dateTime}
          title={whenTitle}
          className="shrink-0 whitespace-nowrap font-mono text-[12px] leading-none text-[var(--text-muted)]"
        >
          {when}
        </time>
      )}
    </>
  );

  return (
    <li className="flex items-center gap-1 rounded-[18px] transition-colors hover:bg-[var(--bg-surface-muted)]">
      {href ? (
        <Link href={href} className={OPEN}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={OPEN}>
          {body}
        </button>
      )}
      {onDelete && (
        <ConfirmDelete label={deleteLabel ?? `Remove ${title}`} onConfirm={onDelete} className="mr-2 h-8 min-w-8" />
      )}
    </li>
  );
}
