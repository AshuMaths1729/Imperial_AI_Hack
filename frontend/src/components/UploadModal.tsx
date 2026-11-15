"use client";

import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  Link2,
  Loader2,
  MessageSquarePlus,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { WorkspaceMode } from "../types/scholartwin";

interface NewConversationPanelProps {
  loading: boolean;
  error: string | null;
  mode?: WorkspaceMode;
  onModeChange?: (mode: WorkspaceMode) => void;
  /** When provided, a close button is shown (modal usage). */
  onClose?: () => void;
  onUploadPdf: (file: File) => void;
  onIngestUrl: (url: string) => void;
  /** "hero" renders the larger, animated variant used on the library screens. */
  variant?: "compact" | "hero";
  dropHint?: string;
  dropSubHint?: string;
}

interface UploadModalProps extends Omit<NewConversationPanelProps, "onClose" | "variant"> {
  open: boolean;
  onClose: () => void;
}

const MODE_OPTIONS: { id: WorkspaceMode; label: string }[] = [
  { id: "lecture", label: "LectureGraph" },
  { id: "paper2sim", label: "Paper2Sim" },
  { id: "hypothesis", label: "HypothesisGraph" },
];

/* The panel's hue follows an inherited --tint (a library screen sets it to its module hue),
   falling back to the accent. --ncp-c / --ncp-soft are local names so nothing is cyclic. */
const HUE_VARS = {
  "--ncp-c": "var(--tint, var(--accent))",
  "--ncp-soft": "color-mix(in srgb, var(--ncp-c) 13%, transparent)",
} as React.CSSProperties;

export function NewConversationPanel({
  loading,
  error,
  mode,
  onModeChange,
  onClose,
  onUploadPdf,
  onIngestUrl,
  variant = "compact",
  dropHint = "Drop a lecture or paper PDF here, or click to browse",
  dropSubHint = "Extracts slides/sections into a clickable graph",
}: NewConversationPanelProps) {
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
    if (!urlInput.trim()) return;
    onIngestUrl(urlInput.trim());
  };

  return (
    <div
      style={HUE_VARS}
      // No overflow on the hero (its rotating glow border sits 1px outside the box). The compact
      // dialog scrolls inside itself on short screens; its own shadow is never clipped by that.
      className={`apple-glass-elevated relative rounded-3xl border ${
        hero ? "st-glow-border p-5 sm:p-7" : "max-h-[calc(100dvh-2.5rem)] overflow-y-auto p-5"
      }`}
    >
      <div className={`flex items-center justify-between gap-3 ${hero ? "mb-5" : "mb-3"}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--ncp-c)_28%,transparent)] bg-[var(--ncp-soft)] text-[var(--ncp-c)] shadow-[inset_0_1px_0_var(--glass-highlight)] ${
              hero ? "st-float h-10 w-10" : "h-8 w-8"
            }`}
          >
            <MessageSquarePlus className={hero ? "h-5 w-5" : "h-3.5 w-3.5"} />
          </span>
          <h2
            className={`apple-heading truncate font-semibold text-[var(--text-primary)] ${
              hero ? "text-lg" : "text-sm"
            }`}
          >
            New Conversation
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="apple-press apple-focus grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mode && onModeChange && (
        <div className="apple-seg mb-3 flex items-center gap-1 rounded-full p-1">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onModeChange(opt.id)}
              title={opt.label}
              aria-pressed={mode === opt.id}
              // flex-auto: segments size to their labels and share the slack, so the longest
              // label still fits on a phone; truncate is only a last resort.
              className={`apple-press apple-focus min-w-0 flex-auto truncate rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                mode === opt.id
                  ? "apple-seg-on text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Drag & Drop PDF Zone */}
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
        className={`apple-press apple-focus group flex cursor-pointer flex-col items-center justify-center border-2 border-dashed text-center transition-all duration-300 ${
          hero ? "rounded-3xl px-5 py-8 sm:p-9" : "rounded-2xl p-6"
        } ${
          dragOver
            ? "scale-[1.02] border-[var(--ncp-c)] bg-[var(--ncp-soft)] shadow-lg"
            : "border-[var(--border-strong)] bg-[var(--bg-surface-muted)] hover:border-[var(--ncp-c)] hover:bg-[var(--ncp-soft)]"
        }`}
      >
        <Upload
          className={`text-[var(--ncp-c)] transition-transform duration-300 group-hover:-translate-y-1 ${
            hero ? "st-bob mb-3 h-8 w-8" : "mb-2 h-6 w-6"
          } ${dragOver ? "-translate-y-1 scale-110" : ""}`}
        />
        <p className={`font-medium text-[var(--text-primary)] ${hero ? "text-sm" : "text-xs"}`}>
          {dragOver ? "Release to upload" : dropHint}
        </p>
        <p className={`mt-1 text-[var(--text-muted)] ${hero ? "text-xs" : "text-[11px]"}`}>
          {dropSubHint}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div
        className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] ${
          hero ? "my-5" : "my-4"
        }`}
      >
        <div className="h-px min-w-3 flex-1 bg-[var(--border-subtle)]" />
        <span className="text-center">OR PASTE ARXIV URL / ID</span>
        <div className="h-px min-w-3 flex-1 bg-[var(--border-subtle)]" />
      </div>

      {/* URL / arXiv ID Form */}
      <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://arxiv.org/abs/1706.03762"
            aria-label="arXiv URL or ID"
            className={`apple-focus w-full min-w-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] pl-9 pr-4 text-[var(--text-primary)] placeholder-[var(--text-muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition focus:border-[var(--ncp-c)] ${
              hero ? "py-3 text-sm" : "py-2 text-xs"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !urlInput.trim()}
          className={`apple-tint apple-press apple-focus group/load flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 ${
            hero ? "px-5 py-3 text-sm" : "px-4 py-2 text-xs"
          }`}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Load
              {hero && (
                <ArrowRight className="h-4 w-4 transition-transform group-hover/load:translate-x-0.5" />
              )}
            </>
          )}
        </button>
      </form>

      {loading && hero && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-[var(--bg-surface-muted)]">
          <div className="st-progress h-full w-1/3 rounded-full bg-gradient-to-r from-[var(--ncp-c)] to-[var(--status-support)]" />
        </div>
      )}

      {error && (
        <div className="st-shake mt-3 flex items-start gap-2 rounded-2xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3.5 py-2.5 text-xs text-[var(--status-contradict)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{error}</span>
        </div>
      )}
    </div>
  );
}

export function UploadModal({ open, onClose, ...panelProps }: UploadModalProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="New conversation"
      className="apple-materialize fixed bottom-5 right-5 left-5 z-50 origin-bottom-right sm:left-auto sm:w-full sm:max-w-md"
    >
      <NewConversationPanel {...panelProps} onClose={onClose} />
    </div>
  );
}
