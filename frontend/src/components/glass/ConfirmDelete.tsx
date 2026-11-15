"use client";

import React, { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * A delete control that asks once: the first click turns the bin into a "Delete?" pill, a second click deletes.
 * It disarms on blur, when the pointer leaves, or after a few seconds, so a stray click never removes anything.
 */
export function ConfirmDelete({
  label,
  onConfirm,
  className = "",
  iconClassName = "h-4 w-4",
}: {
  /** Accessible name, e.g. "Remove Attention Is All You Need". */
  label: string;
  onConfirm: () => void;
  className?: string;
  iconClassName?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      aria-label={armed ? `Confirm: ${label}` : label}
      title={armed ? "Click again to delete" : label}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
      onMouseLeave={() => setArmed(false)}
      className={`apple-press apple-focus inline-flex shrink-0 items-center justify-center gap-1 rounded-full transition ${
        armed
          ? "!opacity-100 bg-[var(--status-contradict)] px-2.5 text-[11.5px] font-semibold text-[var(--status-contradict-fg)]"
          : "text-[var(--text-muted)] hover:bg-[var(--status-contradict-soft)] hover:text-[var(--status-contradict)]"
      } ${className}`}
    >
      <Trash2 className={iconClassName} aria-hidden />
      {armed && <span>Delete?</span>}
    </button>
  );
}
