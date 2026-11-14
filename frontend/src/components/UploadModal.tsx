"use client";

import React, { useState, useRef } from "react";
import { X, Upload, Link2, Loader2 } from "lucide-react";

interface UploadModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onUploadPdf: (file: File) => void;
  onIngestUrl: (url: string) => void;
}

export function UploadModal({
  open,
  loading,
  error,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Load Lecture PDF or arXiv URL</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

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
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? "border-sky-400 bg-sky-500/10"
              : "border-slate-700 bg-slate-950/60 hover:border-sky-500"
          }`}
        >
          <Upload className="mb-2 h-6 w-6 text-sky-400" />
          <p className="text-xs font-medium text-slate-200">
            Drop a lecture or paper PDF here, or click to browse
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Extracts slides/sections into a clickable graph</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="my-4 flex items-center gap-2 text-[11px] text-slate-500">
          <div className="h-px flex-1 bg-slate-800" />
          OR PASTE ARXIV URL / ID
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        {/* URL / arXiv ID Form */}
        <form onSubmit={handleUrlSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://arxiv.org/abs/1706.03762"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-8 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !urlInput.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load"}
          </button>
        </form>

        {error && (
          <p className="mt-3 rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
