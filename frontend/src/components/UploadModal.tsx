"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, FileUp, Link2, Loader2, Upload, X } from "lucide-react";
import { WorkspaceMode } from "../types/scholartwin";
import { MODULES, MODULE_ORDER } from "../modules";

interface OpenPaperPanelProps {
  loading: boolean;
  error: string | null;
  mode?: WorkspaceMode;
  onModeChange?: (mode: WorkspaceMode) => void;
  /** When provided, a close button is shown (modal usage). */
  onClose?: () => void;
  onUploadPdf: (file: File) => void;
  onIngestUrl: (url: string) => void;
  /** "hero" is the larger panel on the Paper Simulator start screen; "compact" the dialog. */
  variant?: "compact" | "hero";
  dropHint?: string;
  dropSubHint?: string;
}

interface UploadModalProps extends Omit<OpenPaperPanelProps, "onClose" | "variant"> {
  open: boolean;
  onClose: () => void;
  /** Module hue token for the dialog's icon, drop zone and Open button (default: accent). */
  tint?: string;
}

/* The panel's hue follows an inherited --tint (the Paper Simulator start screen sets its module
   hue), falling back to the accent. --ncp-c / --ncp-soft are local names so nothing is cyclic. */
const HUE_VARS = {
  "--ncp-c": "var(--tint, var(--accent))",
  "--ncp-soft": "color-mix(in srgb, var(--ncp-c) 12%, transparent)",
} as React.CSSProperties;

/**
 * "Open a paper": drop a PDF (or click to browse, keyboard-operable) or paste an arXiv URL / ID.
 */
export function OpenPaperPanel({
  loading,
  error,
  mode,
  onModeChange,
  onClose,
  onUploadPdf,
  onIngestUrl,
  variant = "compact",
  dropHint = "Drop a PDF here, or click to browse",
  dropSubHint = "Its equations become a live chart you can play with.",
}: OpenPaperPanelProps) {
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hero = variant === "hero";

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onUploadPdf(file);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || loading) return;
    onIngestUrl(urlInput.trim());
  };

  return (
    <div
      style={HUE_VARS}
      // Hero: a thick glass card with the lens rim. Compact: the floating dialog, which scrolls
      // inside itself on short screens.
      className={`relative rounded-[26px] border ${
        hero ? "apple-card glass-lens p-5 sm:p-6" : "apple-glass-elevated max-h-[calc(100dvh-2.5rem)] overflow-y-auto p-5"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] shadow-[inset_0_1px_0_var(--glass-rim)]"
            style={{ backgroundColor: "var(--ncp-c)", color: "var(--accent-fg)" }}
          >
            <FileUp className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <h2 className={`truncate font-normal tracking-[-0.02em] text-[var(--text-primary)] ${hero ? "text-[22px]" : "text-[18px]"}`}>
            Open a paper
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="apple-press apple-focus grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mode && onModeChange && (
        <div className="apple-seg mb-3 flex items-center gap-1 rounded-full p-1">
          {MODULE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onModeChange(id)}
              title={MODULES[id].name}
              aria-pressed={mode === id}
              className={`apple-press apple-focus min-w-0 flex-auto truncate rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition ${
                mode === id ? "apple-seg-on text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {MODULES[id].name}
            </button>
          ))}
        </div>
      )}

      {/* Drag & drop PDF zone (also a button: click or Enter / Space to browse) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={dropHint}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`apple-press apple-focus group flex cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed text-center transition-colors duration-300 ${
          hero ? "px-5 py-8 sm:py-10" : "p-6"
        } ${
          dragOver
            ? "border-[var(--ncp-c)] bg-[var(--ncp-soft)]"
            : "border-[var(--border-strong)] bg-[var(--bg-surface-muted)] hover:border-[var(--ncp-c)] hover:bg-[var(--ncp-soft)]"
        }`}
      >
        <Upload
          aria-hidden
          className={`text-[var(--ncp-c)] transition-transform duration-300 group-hover:-translate-y-1 ${
            hero ? "mb-3 h-7 w-7" : "mb-2 h-6 w-6"
          } ${dragOver ? "-translate-y-1" : ""}`}
        />
        <p className={`font-medium text-[var(--text-primary)] ${hero ? "text-[15px]" : "text-[13.5px]"}`}>
          {dragOver ? "Release to open" : dropHint}
        </p>
        <p className={`mt-1 text-[var(--text-secondary)] ${hero ? "text-[13.5px]" : "text-[12.5px]"}`}>{dropSubHint}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = ""; // choosing the same file again still fires
          }}
        />
      </div>

      <div className="my-4 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        <div className="h-px min-w-3 flex-1 bg-[var(--border-subtle)]" />
        <span className="text-center">or paste an arXiv URL or ID</span>
        <div className="h-px min-w-3 flex-1 bg-[var(--border-subtle)]" />
      </div>

      {/* URL / arXiv ID form */}
      <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="arxiv.org/abs/1706.03762"
            aria-label="arXiv URL or ID"
            className={`apple-focus w-full min-w-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] pl-10 pr-4 text-[var(--text-primary)] placeholder-[var(--text-muted)] transition focus:border-[var(--ncp-c)] ${
              hero ? "h-11 text-[14.5px]" : "h-10 text-[13.5px]"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !urlInput.trim()}
          aria-label={loading ? "Opening the paper" : "Open"}
          style={{ "--tint": "var(--ncp-c)" } as React.CSSProperties}
          className={`apple-tint apple-press apple-focus group/load flex shrink-0 items-center gap-1.5 rounded-full px-4 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            hero ? "h-11 text-[14.5px] sm:px-5" : "h-10 text-[13.5px]"
          }`}
        >
          {loading ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Open
              <ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover/load:translate-x-0.5" />
            </>
          )}
        </button>
      </form>

      {loading && (
        <div role="status" className="mt-4">
          <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-surface-muted)]">
            <div className="st-progress h-full w-1/3 rounded-full bg-[var(--ncp-c)]" />
          </div>
          <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">Reading the paper and building its simulation…</p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="st-shake mt-3 flex items-start gap-2 rounded-2xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3.5 py-2.5 text-[13px] text-[color-mix(in_srgb,var(--status-contradict)_80%,var(--text-primary))]"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </div>
      )}
    </div>
  );
}

/** Kept for older imports: the panel used to be called "New Conversation". */
export const NewConversationPanel = OpenPaperPanel;

/** The floating "Open a paper" dialog used inside the Paper Simulator workspace. */
export function UploadModal({ open, onClose, tint, ...panelProps }: UploadModalProps) {
  // Escape closes the dialog (it is non-modal, so focus is not trapped).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Open a paper"
      style={tint ? ({ "--tint": tint } as React.CSSProperties) : undefined}
      className="apple-materialize fixed bottom-5 left-5 right-5 z-50 origin-bottom-right sm:left-auto sm:w-full sm:max-w-md"
    >
      <OpenPaperPanel {...panelProps} onClose={onClose} />
    </div>
  );
}
