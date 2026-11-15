"use client";

import { useState, type ComponentType, type CSSProperties, type FormEvent } from "react";
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
      title={label}
      aria-pressed={pressed}
      className={`apple-press apple-focus flex min-w-[44px] flex-col items-center gap-1 rounded-2xl border px-1.5 py-1.5 sm:px-2 text-[11px] font-medium sm:min-w-14 ${
        accent
          ? "border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] text-[var(--status-warning)] hover:border-[var(--status-warning)]"
          : pressed
            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)] hover:border-[var(--accent)]"
            : off
              ? "border-transparent text-[var(--status-contradict)] hover:bg-[var(--bg-surface-muted)]"
              : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)]"
      }`}
    >
      <I className="h-5 w-5" />
      {/* Icon-only on phones (the label stays the accessible name), so the bar keeps to one or two rows. */}
      <span className="max-sm:sr-only">{label}</span>
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
      className="apple-glass flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[28px] border px-2.5 py-2 sm:px-3"
    >
      <div className="flex items-center gap-0.5 sm:gap-1">
        <ControlButton icon={p.mic ? Mic : MicOff} label={p.mic ? "Mute" : "Unmute"} off={!p.mic} onClick={p.onMic} />
        <ControlButton
          icon={p.cam ? Video : VideoOff}
          label={p.cam ? "Stop video" : "Start video"}
          off={!p.cam}
          onClick={p.onCam}
        />
      </div>

      <div className="flex flex-wrap items-center gap-0.5 sm:gap-1">
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
            className="apple-focus w-56 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] py-2 pl-4 pr-10 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            className="apple-tint apple-press apple-focus absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full"
          >
            <Send className="h-3 w-3" />
          </button>
        </form>
        <button
          type="button"
          onClick={p.onLeave}
          style={{ "--tint": "var(--status-contradict)", color: "var(--status-contradict-fg)" } as CSSProperties}
          className="apple-tint apple-press apple-focus flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold hover:opacity-90"
        >
          <PhoneOff className="h-4 w-4" aria-hidden />
          Leave
        </button>
      </div>
    </div>
  );
}
