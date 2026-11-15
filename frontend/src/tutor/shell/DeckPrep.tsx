"use client";

import { useEffect, useState } from "react";
import { Loader2, Play, Presentation, RefreshCw, X } from "lucide-react";
import { SlidesStage, type DeckView } from "@/tutor/slides";
import { getDeck, prepareDeck } from "./api";

const POLL_MS = 3000;

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
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--st-line)] pt-2">
      <Presentation className="h-3.5 w-3.5 shrink-0 text-[var(--st-muted)]" aria-hidden />
      <p role="status" className={`min-w-0 flex-1 text-[11px] ${err || view?.status === "failed" ? "text-[var(--st-danger)]" : "text-[var(--st-muted)]"}`}>
        {generating && <Loader2 className="mr-1 inline h-3 w-3 animate-spin align-[-2px]" aria-hidden />}
        {offer && view && !generating && !err ? "Your PDF is in. Prepare slides to build the lesson from it." : statusLine(view, err)}
      </p>
      {view?.deck && (
        <button
          type="button"
          onClick={() => setPreview(true)}
          className="flex items-center gap-1 rounded-xl border border-[var(--st-line-strong)] px-2.5 py-1 text-[11px] font-medium text-[var(--st-text-2)] transition-colors hover:border-[var(--st-accent)]"
        >
          <Play className="h-3 w-3" aria-hidden /> Preview
        </button>
      )}
      <button
        type="button"
        onClick={prepare}
        disabled={generating || !view}
        className={`flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
          offer
            ? "border-[var(--st-accent)] bg-[var(--st-accent)] text-[var(--st-accent-fg)] hover:bg-[var(--st-accent-hover)]"
            : "border-[var(--st-line-strong)] text-[var(--st-text-2)] hover:border-[var(--st-accent)]"
        }`}
      >
        <RefreshCw className="h-3 w-3" aria-hidden /> {!offer && view?.source === "generated" ? "Regenerate slides" : "Prepare slides"}
      </button>

      {preview && view?.deck && (
        <div role="dialog" aria-label="Slides preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative aspect-video w-full max-w-6xl overflow-hidden rounded-xl ring-1 ring-white/10">
            <SlidesStage deck={view.deck} />
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setPreview(false)}
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-slate-900/80 text-slate-300 transition-colors hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
