import type { Caption } from "./session";

/** The latest words of `text`, cut from the left at a word boundary (≤ `max` chars plus a leading "…"). */
export function captionTail(text: string, max = 90): string {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const sp = cut.indexOf(" ");
  return `…${sp >= 0 ? cut.slice(sp + 1) : cut}`;
}

/**
 * One-line captions: a thin bar under the stage with just the current speaker's latest words, so it never covers the
 * board toolbar or the slide controls. Long lines lose their start (the flex end-alignment clips overflow on the left).
 */
export function CaptionsOverlay({ captions, tutorName }: { captions: Caption[]; tutorName: string }) {
  const c = captions.at(-1);
  return (
    <div
      data-testid="captions-overlay"
      aria-live="polite"
      className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3.5 text-sm leading-none"
    >
      {c && (
        <>
          <span className={`apple-label shrink-0 text-[10px] font-semibold uppercase ${c.who === "tutor" ? "text-[var(--accent)]" : "text-[var(--status-warning)]"}`}>
            {c.who === "tutor" ? tutorName : "You"}
          </span>
          <p className={`flex min-w-0 justify-end overflow-hidden whitespace-nowrap ${c.final ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
            {captionTail(c.text)}
          </p>
        </>
      )}
    </div>
  );
}
