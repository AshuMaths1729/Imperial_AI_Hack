"use client";

import { useRef, useState, type FormEvent } from "react";
import { Link2, Loader2, Upload } from "lucide-react";
import { addMaterial, ingestUrl, uploadPdf, type Track } from "./api";
import { DeckPrep } from "./DeckPrep";

const UNREADABLE = "Couldn't read that PDF. Check it opens, has selectable text (not a scan) and isn't password-protected.";

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
        const n = t.knowledge_points.length;
        return `Added ${f.name}. The track now has ${n} knowledge point${n === 1 ? "" : "s"}.`;
      },
      pdfError
    );
  };

  return (
    <div className="space-y-2">
      <form onSubmit={onUrl} className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--st-muted)]" aria-hidden />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Material URL"
            placeholder="https://arxiv.org/abs/…"
            className="w-full rounded-xl border border-[var(--st-line-strong)] bg-[var(--st-surface)] py-2 pl-8 pr-2 text-xs text-[var(--st-text)] placeholder-[var(--st-muted)] focus:border-[var(--st-accent)] focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!!busy || !url.trim()}
          className="rounded-xl bg-black/5 px-3 text-xs font-medium text-[var(--st-text)] transition-colors hover:bg-black/10 disabled:opacity-50"
        >
          Add URL
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 rounded-xl bg-black/5 px-3 text-xs font-medium text-[var(--st-text)] transition-colors hover:bg-black/10 disabled:opacity-50"
        >
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
        <p role="status" className="text-[11px] text-[var(--st-muted)]">
          {busy === "pdf" ? "Reading the PDF… building knowledge points" : "Reading material…"}
        </p>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-[11px] ${msg.ok ? "text-[var(--st-accent)]" : "text-[var(--st-danger)]"}`}>
          {msg.text}
        </p>
      )}
      <DeckPrep key={pdfs} trackId={trackId} offer={pdfs > 0} />
    </div>
  );
}
