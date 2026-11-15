"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Play, Presentation, RefreshCw, X } from "lucide-react";
import { SlidesStage, type DeckView } from "@/tutor/slides";
import { getDeck, prepareDeck } from "./api";

const POLL_MS = 3000;
/** Quiet pill buttons; disabled keeps legible muted ink instead of fading out. */
const QUIET =
  "apple-press apple-focus flex items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:text-[var(--text-muted)] disabled:hover:text-[var(--text-muted)]";

function statusLine(v: DeckView | null, err?: string): string {
  if (err) return err;
  if (!v) return "Checking slides…";
  if (v.status === "generating") return "Generating animated slides… (about a minute; you can join meanwhile)";
  const n = v.deck?.slides.length ?? 0;
  const failed = v.status === "failed" ? `Generation failed (${v.error || "unknown error"}). ` : "";
  if (v.source === "generated") return `${failed}${n} animated slides ready.`;
  if (v.source === "fallback") return `${failed}Using the built-in ${n}-slide deck.`;
  return `${failed}No slides yet.`;
}

/**
 * Prepare (or regenerate) the track's animated deck, and preview it. Key it by track.
 * `offer`: a PDF was just added, so invite building the slides from it (until the student does).
 */
export function DeckPrep({ trackId, offer: offered = false }: { trackId: string; offer?: boolean }) {
  const [view, setView] = useState<DeckView | null>(null);
  const [err, setErr] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [offer, setOffer] = useState(offered);
  const generating = view?.status === "generating";

  useEffect(() => {
    let alive = true;
    getDeck(trackId).then(
      (v) => alive && setView(v),
      (e) => alive && setErr(`Couldn't check slides (${e instanceof Error ? e.message : e}).`)
    );
    return () => {
      alive = false;
    };
  }, [trackId]);

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => getDeck(trackId).then(setView, () => {}), POLL_MS);
    return () => clearInterval(t);
  }, [generating, trackId]);

  const prepare = async () => {
    setErr(undefined);
    setOffer(false);
    try {
      setView(await prepareDeck(trackId));
    } catch (e) {
      setErr(`Couldn't start generating slides (${e instanceof Error ? e.message : e}).`);
    }
  };

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
        <span>{offer && view && !generating && !err ? "Your PDF is in. Prepare slides to build the lesson from it." : statusLine(view, err)}</span>
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
        className={offer && !generating && view ? "apple-tint st-sheen apple-press apple-focus relative flex items-center gap-1 overflow-hidden rounded-full px-2.5 py-1 text-[11px] font-semibold" : QUIET}
      >
        <RefreshCw className="h-3 w-3" aria-hidden /> {!offer && view?.source === "generated" ? "Regenerate slides" : "Prepare slides"}
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
