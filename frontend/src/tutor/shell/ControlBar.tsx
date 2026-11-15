"use client";

import { useState, type ComponentType, type FormEvent } from "react";
import { Captions, Hand, Lasso, Mic, MicOff, MonitorUp, PenTool, PhoneOff, Send, Video, VideoOff } from "lucide-react";

type Icon = ComponentType<{ className?: string }>;

function ControlButton({
  icon: I,
  label,
  onClick,
  pressed,
  off,
  accent,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  off?: boolean; // device is off: red-tinted like Zoom's muted mic
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[var(--st-accent)] ${
        accent
          ? "bg-[var(--st-warn-soft)] text-[var(--st-warn)] hover:bg-[#8a4b12]/20"
          : pressed
            ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)] ring-1 ring-[var(--st-accent-border)] hover:bg-[#1e4a33]/15"
            : off
              ? "text-[var(--st-danger)] hover:bg-black/5"
              : "text-[var(--st-text-2)] hover:bg-black/5"
      }`}
    >
      <I className="h-5 w-5" />
      {label}
    </button>
  );
}

type Props = {
  mic: boolean;
  cam: boolean;
  sharing: boolean;
  boardShown: boolean;
  circleMode: boolean;
  captionsOn: boolean;
  onMic: () => void;
  onCam: () => void;
  onShare: () => void;
  onBoard: () => void;
  onCircle: () => void;
  onLost: () => void;
  onCaptions: () => void;
  onSendText: (t: string) => void;
  onLeave: () => void;
};

export function ControlBar(p: Props) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    p.onSendText(t);
    setText("");
  };
  return (
    <div
      role="toolbar"
      aria-label="Lesson controls"
      className="st-glass flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[18px] px-3 py-2"
    >
      <div className="flex items-center gap-1">
        <ControlButton icon={p.mic ? Mic : MicOff} label={p.mic ? "Mute" : "Unmute"} off={!p.mic} onClick={p.onMic} />
        <ControlButton
          icon={p.cam ? Video : VideoOff}
          label={p.cam ? "Stop video" : "Start video"}
          off={!p.cam}
          onClick={p.onCam}
        />
      </div>

      <div className="flex items-center gap-1">
        <ControlButton icon={MonitorUp} label="Share screen" pressed={p.sharing} onClick={p.onShare} />
        <ControlButton icon={PenTool} label="Board" pressed={p.boardShown} onClick={p.onBoard} />
        <ControlButton icon={Lasso} label="Circle" pressed={p.circleMode} onClick={p.onCircle} />
        <ControlButton icon={Hand} label="I'm lost" accent onClick={p.onLost} />
        <ControlButton icon={Captions} label="Captions" pressed={p.captionsOn} onClick={p.onCaptions} />
      </div>

      <div className="flex items-center gap-2">
        <form onSubmit={submit} className="relative hidden sm:block">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Type to the tutor"
            placeholder="Type to the tutor…"
            className="w-56 rounded-full border border-[var(--st-line-strong)] bg-[var(--st-surface)] py-2 pl-4 pr-10 text-xs placeholder-[var(--st-muted)] focus:border-[var(--st-accent)] focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-[var(--st-accent)] text-[var(--st-accent-fg)] transition-colors hover:bg-[var(--st-accent-hover)]"
          >
            <Send className="h-3 w-3" />
          </button>
        </form>
        <button
          type="button"
          onClick={p.onLeave}
          className="flex items-center gap-1.5 rounded-full bg-[var(--st-danger)] px-4 py-2.5 text-xs font-semibold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-[#8a2c17] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-danger)]"
        >
          <PhoneOff className="h-4 w-4" aria-hidden />
          Leave
        </button>
      </div>
    </div>
  );
}
