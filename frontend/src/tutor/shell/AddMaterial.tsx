"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link2, Loader2, Upload } from "lucide-react";
import { addMaterial, getTrack, ingestUrl, uploadPdf, type Track } from "./api";
import { DeckPrep } from "./DeckPrep";

/** Quiet pill buttons; disabled keeps legible muted ink instead of fading out. */
const BTN =
  "apple-press apple-focus flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:text-[var(--text-muted)] disabled:hover:text-[var(--text-muted)]";

const UNREADABLE ="Couldn't read that PDF. Check it opens, has selectable text (not a scan) and isn't password-protected.";

/** A clear message for a failed PDF upload (`status` comes from api.request; none means the request never got through). */
function pdfError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  const text = e instanceof Error ? e.message : String(e);
  if (status === 413) return "That PDF is too large. Try a smaller file, or split it into parts.";
  // a plain-string `detail` is the backend's own reason; "HTTP 4xx" or a JSON validation list is not readable
  if (status && status < 500) return /^(HTTP \d|\[|\{)/.test(text) ? UNREADABLE : `Couldn't read that PDF: ${text}`;
  if (!status) return "Couldn't reach the server. Check your connection and try again.";
  return `The server failed while reading the PDF (${text}). Try again.`;
}

/** The upload answers at once with quick heading key points; the model's arrive a few seconds later. */
const KP_REFRESH_MS = 1500;
const KP_REFRESH_TRIES = 16;

/**
 * URL → team ingest → add to track; PDF → the track's full-text PDF endpoint. Then the deck can be prepared from the
 * new material (DeckPrep, re-read after each PDF).
 */
export function AddMaterial({ trackId, onAdded }: { trackId: string; onAdded: (t: Track) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"url" | "pdf">();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [pdfs, setPdfs] = useState(0); // PDFs added here: remounts DeckPrep with the offer (key this by track)
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Swap in the model's key points once the backend has written them (background, ~5 s after an upload). */
  const refreshKps = async (before: Track) => {
    const was = JSON.stringify(before.knowledge_points);
    for (let i = 0; i < KP_REFRESH_TRIES && alive.current; i++) {
      await new Promise((r) => setTimeout(r, KP_REFRESH_MS));
      const latest = await getTrack(trackId).then((d) => d.track, () => null);
      if (!alive.current) return;
      if (latest && JSON.stringify(latest.knowledge_points) !== was) {
        onAdded(latest);
        setMsg({ ok: true, text: `Key points ready: the track now has ${latest.knowledge_points.length}.` });
        return;
      }
    }
  };

  const run = async (kind: "url" | "pdf", work: () => Promise<string>, fail: (e: unknown) => string) => {
    setBusy(kind);
    setMsg(undefined);
    try {
      setMsg({ ok: true, text: await work() });
    } catch (e) {
      setMsg({ ok: false, text: fail(e) });
    } finally {
      setBusy(undefined);
    }
  };

  const onUrl = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (!u) return;
    void run(
      "url",
      async () => {
        const dataset = await ingestUrl(u);
        onAdded(await addMaterial(trackId, { kind: "url", ref: u, dataset }));
        setUrl("");
        const n = dataset.nodes.length;
        return `Added ${n} knowledge point${n === 1 ? "" : "s"}`;
      },
      (e) => (e instanceof Error ? e.message : String(e))
    );
  };

  const onPdf = (f: File) => {
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      setMsg({ ok: false, text: `${f.name} isn't a PDF. Choose a .pdf file.` });
      return;
    }
    void run(
      "pdf",
      async () => {
        const t = await uploadPdf(trackId, f);
        onAdded(t);
        setPdfs((n) => n + 1);
        void refreshKps(t);
        return `Added ${f.name}. Writing its key points now; they appear here in a few seconds.`;
      },
      pdfError
    );
  };

  return (
    <div className="space-y-2">
      <form onSubmit={onUrl} className="flex flex-wrap gap-2">
        <div className="relative min-w-[min(100%,14rem)] flex-1">
          <Link2 className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Material URL"
            placeholder="https://arxiv.org/abs/…"
            className="apple-focus w-full rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
          />
        </div>
        <button type="submit" disabled={!!busy || !url.trim()} className={`${BTN} py-2`}>
          Add URL
        </button>
        <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} className={`${BTN} py-2`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
          PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          aria-label="Upload PDF"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onPdf(f);
          }}
        />
      </form>
      {busy && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span aria-hidden className="relative h-1 w-10 overflow-hidden rounded-full bg-[var(--accent-soft)]">
            <span className="st-progress absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--accent)]" />
          </span>
          {busy === "pdf" ? "Reading the PDF…" : "Reading material…"}
        </p>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-[var(--status-support)]" : "text-[var(--status-contradict)]"}`}>
          {msg.text}
        </p>
      )}
      <DeckPrep key={pdfs} trackId={trackId} offer={pdfs > 0} />
    </div>
  );
}
