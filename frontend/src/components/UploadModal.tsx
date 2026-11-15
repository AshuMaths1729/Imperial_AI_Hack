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
      className={`apple-glass-elevated relative rounded-2xl border ${
        hero ? "st-glow-border p-7" : "p-5"
      }`}
    >
      <div className={`flex items-center justify-between ${hero ? "mb-5" : "mb-3"}`}>
        <div className="flex items-center gap-2.5">
          <span
            className={`flex items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] ${
              hero ? "st-float h-9 w-9" : "h-7 w-7"
            }`}
          >
            <MessageSquarePlus className={hero ? "h-5 w-5" : "h-3.5 w-3.5"} />
          </span>
          <h2
            className={`apple-heading font-semibold text-[var(--text-primary)] ${
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
            className="apple-press apple-focus rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mode && onModeChange && (
        <div className="mb-3 flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-1">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onModeChange(opt.id)}
              className={`apple-press apple-focus flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                mode === opt.id
                  ? "bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
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
        className={`apple-press apple-focus group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-all duration-300 ${
          hero ? "p-9" : "p-6"
        } ${
          dragOver
            ? "scale-[1.02] border-[var(--accent)] bg-[var(--accent-soft)] shadow-lg"
            : "border-[var(--border-strong)] bg-[var(--bg-surface-muted)]/60 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
        }`}
      >
        <Upload
          className={`text-[var(--accent)] transition-transform duration-300 group-hover:-translate-y-1 ${
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
        <div className="h-px flex-1 bg-[var(--border-subtle)]" />
        OR PASTE ARXIV URL / ID
        <div className="h-px flex-1 bg-[var(--border-subtle)]" />
      </div>

      {/* URL / arXiv ID Form */}
      <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Link2
            className={`absolute left-3 h-3.5 w-3.5 text-[var(--text-muted)] ${
              hero ? "top-3.5" : "top-2.5"
            }`}
          />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://arxiv.org/abs/1706.03762"
            aria-label="arXiv URL or ID"
            className={`apple-focus w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-8 pr-3 text-[var(--text-primary)] placeholder-[var(--text-muted)] transition focus:border-[var(--accent)] ${
              hero ? "py-3 text-sm" : "py-2 text-xs"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !urlInput.trim()}
          className={`apple-press apple-focus group/load flex items-center gap-1.5 rounded-xl bg-[var(--accent)] font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-50 ${
            hero ? "px-5 py-3 text-sm" : "px-3.5 py-2 text-xs"
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
          <div className="st-progress h-full w-1/3 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--status-support)]" />
        </div>
      )}

      {error && (
        <div className="st-shake mt-3 flex items-start gap-2 rounded-xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3 py-2 text-xs text-[var(--status-contradict)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
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
