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
}

export function AvatarDock({
  avatarState,
  lastReply,
  isSpeaking,
  ttsEnabled,
  onToggleTts,
  onAsk,
  onUploadClick,
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

  const ringColor =
    avatarState === "emphatic"
      ? "border-amber-400 shadow-amber-500/20"
      : avatarState === "questioning"
      ? "border-purple-400 shadow-purple-500/20"
      : isSpeaking
      ? "border-sky-400 shadow-sky-500/30"
      : "border-slate-700";

  return (
    <aside className="flex h-full flex-col justify-between border-r border-slate-800 bg-slate-900/70 p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            ScholarTwin Tutor
          </span>
          <button
            onClick={onToggleTts}
            title={ttsEnabled ? "Mute voice" : "Enable voice"}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            {ttsEnabled ? <Volume2 className="h-4 w-4 text-sky-400" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>

        {/* Clean Interactive Digital Avatar */}
        <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950/80 p-5">
          <div
            className={`relative flex h-24 w-24 items-center justify-center rounded-full border-2 shadow-lg transition-all duration-300 ${ringColor} ${
              isSpeaking ? "scale-105" : ""
            }`}
          >
            <svg viewBox="0 0 100 100" className="h-20 w-20">
              <circle cx="50" cy="50" r="44" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
              {/* Eyes */}
              <circle cx="36" cy="42" r="4.5" fill="#e2e8f0" />
              <circle cx="64" cy="42" r="4.5" fill="#e2e8f0" />
              <circle cx="37" cy="41" r="1.5" fill="#38bdf8" />
              <circle cx="65" cy="41" r="1.5" fill="#38bdf8" />
              {/* Mouth reacts to speaking */}
              {isSpeaking ? (
                <ellipse cx="50" cy="64" rx="10" ry="6" fill="#38bdf8" className="animate-pulse" />
              ) : (
                <path d="M 38 63 Q 50 71 62 63" stroke="#94a3b8" strokeWidth="3" fill="none" strokeLinecap="round" />
              )}
            </svg>
            <span
              className={`absolute -bottom-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                isSpeaking
                  ? "bg-sky-500 text-slate-950"
                  : listening
                  ? "bg-rose-500 text-white"
                  : "bg-slate-800 text-slate-300"
              }`}
            >
              {listening ? "Listening" : isSpeaking ? "Speaking" : avatarState}
            </span>
          </div>

          <div className="mt-4 w-full rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-200">
            {lastReply}
          </div>
        </div>

        {/* Source Quick Action */}
        <button
          onClick={onUploadClick}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/50 px-3 py-2.5 text-xs font-medium text-slate-300 transition hover:border-sky-500 hover:text-sky-300"
        >
          <Upload className="h-3.5 w-3.5" />
          Drop Lecture PDF / arXiv URL
        </button>
      </div>

      {/* Voice + Text Ask Controls */}
      <div className="space-y-2 pt-3">
        <button
          onClick={handleVoice}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition ${
            listening
              ? "bg-rose-500 text-white animate-pulse"
              : "bg-sky-500 text-slate-950 hover:bg-sky-400"
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
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-slate-800 px-2.5 text-slate-200 hover:bg-slate-700"
            aria-label="Send question"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </aside>
  );
}
