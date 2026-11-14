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
      className={`flex min-w-14 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-[transform,background-color] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-sky-400 ${
        accent
          ? "bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
          : pressed
            ? "bg-sky-500/20 text-sky-200 hover:bg-sky-500/30"
            : off
              ? "text-rose-300 hover:bg-slate-800"
              : "text-slate-200 hover:bg-slate-800"
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
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/95 px-3 py-2"
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
            className="w-56 rounded-lg border border-slate-700 bg-slate-950 py-2 pl-3 pr-9 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send"
            className="absolute right-1 top-1 rounded-md p-1.5 text-slate-400 hover:text-sky-300"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
        <button
          type="button"
          onClick={p.onLeave}
          className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white transition-[transform,background-color] duration-150 ease-out hover:bg-rose-500 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-rose-300"
        >
          <PhoneOff className="h-4 w-4" aria-hidden />
          Leave
        </button>
      </div>
    </div>
  );
}
