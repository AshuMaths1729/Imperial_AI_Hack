"use client";

import { useRef, useState, type FormEvent } from "react";
import { Link2, Loader2, Upload } from "lucide-react";
import type { WorkspaceDataset } from "@/types/scholartwin";
import { addMaterial, ingestPdf, ingestUrl, type Track } from "./api";

/** PDF or URL → team ingest → add to track. The backend seeds one knowledge point per ingested node. */
export function AddMaterial({ trackId, onAdded }: { trackId: string; onAdded: (t: Track) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (kind: "pdf" | "url", ref: string, ingest: () => Promise<WorkspaceDataset>) => {
    setBusy(true);
    setMsg(undefined);
    try {
      const dataset = await ingest();
      onAdded(await addMaterial(trackId, { kind, ref, dataset }));
      const n = dataset.nodes.length;
      setMsg({ ok: true, text: `Added ${n} knowledge point${n === 1 ? "" : "s"}` });
      setUrl("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onUrl = (e: FormEvent) => {
    e.preventDefault();
    const u = url.trim();
    if (u) void run("url", u, () => ingestUrl(u));
  };

  return (
    <div className="space-y-2">
      <form onSubmit={onUrl} className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" aria-hidden />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Material URL"
            placeholder="https://arxiv.org/abs/…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="rounded-lg bg-slate-800 px-3 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:opacity-50"
        >
          Add URL
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:opacity-50"
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
            if (f) void run("pdf", f.name, () => ingestPdf(f));
          }}
        />
      </form>
      {busy && <p className="text-[11px] text-slate-400">Reading material…</p>}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-[11px] ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
