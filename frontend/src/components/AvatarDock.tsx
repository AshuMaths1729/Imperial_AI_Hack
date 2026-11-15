"use client";

import React, { useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Upload } from "lucide-react";

interface AvatarDockProps {
  avatarState: "idle" | "listening" | "explaining" | "emphatic" | "questioning";
  lastReply: string;
  isSpeaking: boolean;
  ttsEnabled: boolean;
  onToggleTts: () => void;
  onAsk: (text: string) => void;
  onUploadClick: () => void;
  /** Replaces the built-in face (e.g. the live tutor tile). */
  avatar?: React.ReactNode;
}

export function AvatarDock({
  avatarState,
  lastReply,
  isSpeaking,
  ttsEnabled,
  onToggleTts,
  onAsk,
  onUploadClick,
  avatar,
}: AvatarDockProps) {
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);

  const handleVoice = () => {
    interface SpeechRecognitionLike {
      lang: string;
      interimResults: boolean;
      onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    }
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRecognitionCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      onAsk("Explain the region I just selected.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    setListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setListening(false);
      onAsk(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onAsk(input.trim());
    setInput("");
  };

  const ringStyle =
    avatarState === "emphatic"
      ? { borderColor: "var(--status-warning)" }
      : avatarState === "questioning"
      ? { borderColor: "var(--status-gap)" }
      : isSpeaking
      ? { borderColor: "var(--accent)" }
      : { borderColor: "var(--border-strong)" };

  return (
    // A floating glass sheet; it scrolls itself at lg (where its grid row is height-bounded).
    <aside className="apple-sheet flex min-w-0 flex-col justify-between gap-3 rounded-[22px] p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="apple-label truncate pl-1 text-[11px] font-semibold uppercase text-[var(--text-muted)]">
            ScholarTwin Tutor
          </span>
          <button
            type="button"
            onClick={onToggleTts}
            title={ttsEnabled ? "Mute voice" : "Enable voice"}
            aria-label={ttsEnabled ? "Mute voice" : "Enable voice"}
            className={`apple-press apple-focus grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
              ttsEnabled
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {ttsEnabled ? (
              <Volume2 className="h-4 w-4 text-[var(--accent)]" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Clean Interactive Digital Avatar */}
        <div className="flex flex-col items-center rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-5">
          {avatar ?? (
            <div
              style={ringStyle}
              className={`relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 shadow-md transition-all duration-200 ${
                isSpeaking ? "scale-105" : ""
              }`}
            >
              <svg viewBox="0 0 100 100" className="h-20 w-20">
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="var(--bg-surface)"
                  stroke="var(--accent)"
                  strokeWidth="2"
                />
                {/* Eyes */}
                <circle cx="36" cy="42" r="4.5" fill="var(--text-primary)" />
                <circle cx="64" cy="42" r="4.5" fill="var(--text-primary)" />
                <circle cx="37" cy="41" r="1.5" fill="var(--accent)" />
                <circle cx="65" cy="41" r="1.5" fill="var(--accent)" />
                {/* Mouth reacts to speaking */}
                {isSpeaking ? (
                  <ellipse cx="50" cy="64" rx="10" ry="6" fill="var(--accent)" className="animate-pulse" />
                ) : (
                  <path
                    d="M 38 63 Q 50 71 62 63"
                    stroke="var(--text-muted)"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                  />
                )}
              </svg>
              <span
                className={`absolute -bottom-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isSpeaking
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : listening
                    ? "bg-[var(--status-contradict)] text-[var(--status-contradict-fg)]"
                    : "border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]"
                }`}
              >
                {listening ? "Listening" : isSpeaking ? "Speaking" : avatarState}
              </span>
            </div>
          )}

          {/* Text sits on thick glass (the sheet + one surface layer). */}
          <div className="mt-4 w-full break-words rounded-2xl border border-[var(--glass-rim)] bg-[var(--bg-surface)] p-3 text-xs leading-relaxed text-[var(--text-secondary)] shadow-[inset_0_1px_0_var(--glass-highlight)]">
            {lastReply}
          </div>
        </div>

        {/* Source Quick Action */}
        <button
          type="button"
          onClick={onUploadClick}
          className="apple-press apple-focus flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-full border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface-muted)] px-4 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Drop Lecture PDF / arXiv URL</span>
        </button>
      </div>

      {/* Voice + Text Ask Controls */}
      {/* The view's one tinted primary is the Live Tutor button on the canvas, so the mic is
          an accent-washed capsule rather than a second solid fill. */}
      <div className="space-y-2 pt-3">
        <button
          type="button"
          onClick={handleVoice}
          className={`apple-press apple-focus flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-full border px-4 text-xs font-semibold ${
            listening
              ? "animate-pulse border-[var(--status-contradict)] bg-[var(--status-contradict)] text-[var(--status-contradict-fg)]"
              : "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)] hover:border-[var(--accent)]"
          }`}
        >
          {listening ? <MicOff className="h-4 w-4 shrink-0" /> : <Mic className="h-4 w-4 shrink-0" />}
          <span className="truncate">{listening ? "Listening... Speak now" : "Hold / Click to Ask Avatar"}</span>
        </button>

        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about circled area..."
            aria-label="Ask the tutor a question"
            className="apple-focus h-10 w-full min-w-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-4 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            className="apple-press apple-focus grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            aria-label="Send question"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
}
