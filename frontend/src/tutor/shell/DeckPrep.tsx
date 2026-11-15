"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Play, Presentation, RefreshCw, X } from "lucide-react";
import { SlidesStage, type DeckView } from "@/tutor/slides";
import { rebuildDeck, useDeck } from "./deckStore";

/** Quiet pill buttons; disabled keeps legible muted ink instead of fading out. */
const QUIET =
  "apple-press apple-focus flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:text-[var(--text-muted)] disabled:hover:text-[var(--text-muted)]";

function statusLine(v: DeckView | null, err?: string): string {
  if (err) return err;
  if (!v) return "Checking slides…";
  if (v.status === "generating") return "Building animated slides from your material… (a minute or two)";
  const n = v.deck?.slides.length ?? 0;
  const failed = v.status === "failed" ? `Generation failed (${v.error || "unknown error"}). ` : "";
  if (v.source === "generated") return `${failed}${n} animated slides ready.`;
  if (v.source === "fallback") return `${failed}Using the built-in ${n}-slide deck.`;
  return `${failed}No slides yet.`;
}

/** The track's animated deck: its status, a preview, and a rebuild button. Adding material builds it by itself. */
export function DeckPrep({ trackId }: { trackId: string }) {
  const { view, err } = useDeck(trackId);
  const [preview, setPreview] = useState(false);
  const generating = view?.status === "generating";
  const prepare = () => void rebuildDeck(trackId);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5">
      {/* The status keeps a readable width; the buttons wrap below it on narrow screens. */}
      <p
        role="status"
        className={`flex min-w-[min(100%,13rem)] flex-1 items-start gap-1.5 text-xs ${err || view?.status === "failed" ? "text-[var(--status-contradict)]" : "text-[var(--text-muted)]"}`}
      >
        {generating ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Presentation className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <span>{statusLine(view, err)}</span>
      </p>
      {view?.deck && (
        <button type="button" onClick={() => setPreview(true)} className={QUIET}>
          <Play className="h-3 w-3" aria-hidden /> Preview
        </button>
      )}
      <button
        type="button"
        onClick={prepare}
        disabled={generating || !view}
        className={QUIET}
      >
        <RefreshCw className="h-3 w-3" aria-hidden /> {view?.source === "generated" ? "Regenerate slides" : "Prepare slides"}
      </button>

      {/* Portalled to body: a dialog under a glass or animated (transformed) pane would be clipped to it. */}
      {preview &&
        view?.deck &&
        createPortal(
          <div role="dialog" aria-label="Slides preview" className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-canvas)_60%,transparent)] p-4 backdrop-blur-sm">
            <div className="apple-materialize relative aspect-video w-full max-w-6xl overflow-hidden rounded-[22px] border border-[var(--glass-rim)] shadow-[var(--shadow-elevated)]">
              <SlidesStage deck={view.deck} />
              <button
                type="button"
                aria-label="Close preview"
                onClick={() => setPreview(false)}
                title="Close preview"
                className="apple-glass-elevated apple-press apple-focus absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
