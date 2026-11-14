"use client";

import React, { useState, useRef } from "react";
import { X, Upload, Link2, Loader2, MessageSquarePlus, AlertTriangle } from "lucide-react";
import { WorkspaceMode } from "../types/scholartwin";

interface UploadModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  mode?: WorkspaceMode;
  onModeChange?: (mode: WorkspaceMode) => void;
  onClose: () => void;
  onUploadPdf: (file: File) => void;
  onIngestUrl: (url: string) => void;
}

const MODE_OPTIONS: { id: WorkspaceMode; label: string }[] = [
  { id: "lecture", label: "LectureGraph" },
  { id: "paper2sim", label: "Paper2Sim" },
  { id: "hypothesis", label: "HypothesisGraph" },
];

export function UploadModal({
  open,
  loading,
  error,
  mode,
  onModeChange,
  onClose,
  onUploadPdf,
  onIngestUrl,
}: UploadModalProps) {
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

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
      role="dialog"
      aria-label="New conversation"
      className="apple-materialize fixed bottom-5 right-5 left-5 z-50 origin-bottom-right sm:left-auto sm:w-full sm:max-w-md"
    >
      <div className="apple-glass-elevated rounded-2xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </span>
            <h2 className="apple-heading text-sm font-semibold text-[var(--text-primary)]">
              New Conversation
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="apple-press apple-focus rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
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
          className={`apple-press flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border-strong)] bg-[var(--bg-surface-muted)]/60 hover:border-[var(--accent)]"
          }`}
        >
          <Upload className="mb-2 h-6 w-6 text-[var(--accent)]" />
          <p className="text-xs font-medium text-[var(--text-primary)]">
            Drop a lecture or paper PDF here, or click to browse
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Extracts slides/sections into a clickable graph
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="my-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          OR PASTE ARXIV URL / ID
          <div className="h-px flex-1 bg-[var(--border-subtle)]" />
        </div>

        {/* URL / arXiv ID Form */}
        <form onSubmit={handleUrlSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://arxiv.org/abs/1706.03762"
              className="apple-focus w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="apple-press apple-focus flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-2 text-xs font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load"}
          </button>
        </form>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3 py-2 text-xs text-[var(--status-contradict)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
