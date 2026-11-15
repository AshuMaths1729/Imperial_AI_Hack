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
      className={`apple-press apple-focus flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-[18px] border px-1.5 py-1.5 text-[11px] font-medium sm:min-w-14 sm:px-2 ${
        accent
          ? "border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] text-[var(--status-warning)] hover:border-[var(--status-warning)]"
          : pressed
            ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)] hover:border-[var(--accent)]"
            : off
              ? "border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] text-[var(--status-contradict)] hover:border-[var(--status-contradict)]"
              : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
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
  const divider = <span aria-hidden className="mx-0.5 hidden h-8 w-px shrink-0 bg-[var(--border-subtle)] sm:block" />;
  return (
    // A glass capsule centred under the stage (it wraps into a rounded pill on phones).
    <div
      role="toolbar"
      aria-label="Lesson controls"
      className="apple-glass-elevated glass-lens relative mx-auto flex max-w-full shrink-0 flex-wrap items-center justify-center gap-1 rounded-[30px] border p-1.5 sm:gap-1.5"
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
      {divider}
      <div className="flex flex-wrap items-center justify-center gap-0.5 sm:gap-1">
        <ControlButton icon={MonitorUp} label="Share screen" pressed={p.sharing} onClick={p.onShare} />
        <ControlButton icon={PenTool} label="Board" pressed={p.boardShown} onClick={p.onBoard} />
        <ControlButton icon={Lasso} label="Circle" pressed={p.circleMode} onClick={p.onCircle} />
        <ControlButton icon={Hand} label="I'm lost" accent onClick={p.onLost} />
        <ControlButton icon={Captions} label="Captions" pressed={p.captionsOn} onClick={p.onCaptions} />
      </div>
      {divider}
      <div className="flex items-center gap-2 pl-0.5 pr-0.5">
        <form onSubmit={submit} className="relative hidden sm:block">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Type to the tutor"
            placeholder="Type to the tutor…"
            className="apple-focus w-52 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] py-2.5 pl-4 pr-11 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none xl:w-60"
          />
          <button
            type="submit"
            aria-label="Send"
            title="Send"
            className="apple-tint apple-press apple-focus absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full"
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
          </button>
        </form>
        {/* Leave stays unmistakably red in every theme: solid --status-contradict with its own foreground. */}
        <button
          type="button"
          onClick={p.onLeave}
          style={{ "--tint": "var(--status-contradict)", color: "var(--status-contradict-fg)" } as CSSProperties}
          className="apple-tint apple-press apple-focus flex min-h-11 items-center gap-1.5 rounded-full px-4 text-xs font-semibold hover:opacity-90"
        >
          <PhoneOff className="h-4 w-4" aria-hidden />
          Leave
        </button>
      </div>
    </div>
  );
}
