"use client";

import React, { useState, useRef } from "react";
import { X, Upload, Link2, Loader2, MessageSquarePlus, ArrowRight } from "lucide-react";
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
      className={`relative rounded-2xl border bg-slate-900/95 shadow-2xl shadow-slate-950/90 backdrop-blur-md ${
        hero ? "st-glow-border border-sky-500/40 p-7" : "border-sky-500/40 p-5"
      }`}
    >
      <div className={`flex items-center justify-between ${hero ? "mb-5" : "mb-3"}`}>
        <div className="flex items-center gap-2.5">
          <span
            className={`flex items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 ${
              hero ? "st-float h-9 w-9" : "h-6 w-6 rounded-md"
            }`}
          >
            <MessageSquarePlus className={hero ? "h-5 w-5" : "h-3.5 w-3.5"} />
          </span>
          <h2 className={`font-semibold text-slate-100 ${hero ? "text-lg" : "text-sm"}`}>
            New Conversation
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mode && onModeChange && (
        <div className="mb-3 flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onModeChange(opt.id)}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                mode === opt.id
                  ? "bg-sky-500 text-slate-950"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
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
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-all duration-300 ${
          hero ? "p-9" : "p-6"
        } ${
          dragOver
            ? "scale-[1.02] border-sky-400 bg-sky-500/10 shadow-lg shadow-sky-500/20"
            : "border-slate-700 bg-slate-950/60 hover:border-sky-500 hover:bg-sky-500/5"
        }`}
      >
        <Upload
          className={`text-sky-400 transition-transform duration-300 group-hover:-translate-y-1 ${
            hero ? "st-bob mb-3 h-8 w-8" : "mb-2 h-6 w-6"
          } ${dragOver ? "-translate-y-1 scale-110" : ""}`}
        />
        <p className={`font-medium text-slate-200 ${hero ? "text-sm" : "text-xs"}`}>
          {dragOver ? "Release to upload" : dropHint}
        </p>
        <p className={`mt-1 text-slate-500 ${hero ? "text-xs" : "text-[11px]"}`}>{dropSubHint}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className={`flex items-center gap-2 text-[11px] text-slate-500 ${hero ? "my-5" : "my-4"}`}>
        <div className="h-px flex-1 bg-slate-800" />
        OR PASTE ARXIV URL / ID
        <div className="h-px flex-1 bg-slate-800" />
      </div>

      {/* URL / arXiv ID Form */}
      <form onSubmit={handleUrlSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Link2
            className={`absolute left-3 h-3.5 w-3.5 text-slate-500 ${hero ? "top-3.5" : "top-2.5"}`}
          />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://arxiv.org/abs/1706.03762"
            className={`w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 text-slate-100 placeholder-slate-500 transition focus:border-sky-500 focus:shadow-[0_0_0_3px_rgba(14,165,233,0.15)] focus:outline-none ${
              hero ? "py-3 text-sm" : "py-2 text-xs"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !urlInput.trim()}
          className={`group/load flex items-center gap-1.5 rounded-lg bg-sky-500 font-semibold text-slate-950 transition hover:bg-sky-400 active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${
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
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-800">
          <div className="st-progress h-full w-1/3 rounded-full bg-gradient-to-r from-sky-500 to-emerald-400" />
        </div>
      )}

      {error && (
        <p className="st-shake mt-3 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
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
      className="fixed bottom-5 right-5 left-5 z-50 sm:left-auto sm:w-full sm:max-w-md"
    >
      <NewConversationPanel {...panelProps} onClose={onClose} />
    </div>
  );
}
