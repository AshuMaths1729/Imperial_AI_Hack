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
    <aside className="flex h-full flex-col justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">
            ScholarTwin Tutor
          </span>
          <button
            type="button"
            onClick={onToggleTts}
            title={ttsEnabled ? "Mute voice" : "Enable voice"}
            aria-label={ttsEnabled ? "Mute voice" : "Enable voice"}
            className="apple-press apple-focus rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
          >
            {ttsEnabled ? (
              <Volume2 className="h-4 w-4 text-[var(--accent)]" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Clean Interactive Digital Avatar */}
        <div className="flex flex-col items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-5">
          {avatar ?? (
            <div
              style={ringStyle}
              className={`relative flex h-24 w-24 items-center justify-center rounded-full border-2 shadow-md transition-all duration-200 ${
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
                className={`absolute -bottom-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  isSpeaking
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : listening
                    ? "bg-[var(--status-contradict)] text-white"
                    : "border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]"
                }`}
              >
                {listening ? "Listening" : isSpeaking ? "Speaking" : avatarState}
              </span>
            </div>
          )}

          <div className="mt-4 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            {lastReply}
          </div>
        </div>

        {/* Source Quick Action */}
        <button
          type="button"
          onClick={onUploadClick}
          className="apple-press apple-focus flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface-muted)]/50 px-3 py-2.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Upload className="h-3.5 w-3.5" />
          Drop Lecture PDF / arXiv URL
        </button>
      </div>

      {/* Voice + Text Ask Controls */}
      <div className="space-y-2 pt-3">
        <button
          type="button"
          onClick={handleVoice}
          className={`apple-press apple-focus flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${
            listening
              ? "animate-pulse bg-[var(--status-contradict)] text-white"
              : "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
          }`}
        >
          {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {listening ? "Listening... Speak now" : "Hold / Click to Ask Avatar"}
        </button>

        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about circled area..."
            className="apple-focus w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            className="apple-press apple-focus rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            aria-label="Send question"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
}
