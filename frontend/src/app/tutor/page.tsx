"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  GraduationCap,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Repeat,
  Send,
  Volume2,
} from "lucide-react";
import { listTutors, type Tutor } from "@/tutor/api";
import { AvatarVideo, Portrait, portrait, voiceSample } from "@/tutor/media";
import { useAvatarCall, type Caption } from "@/tutor/useAvatarCall";

const LessonBoard = dynamic(() => import("@/tutor/LessonBoard"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-slate-500">Loading whiteboard…</div>,
});

function TutorCard({
  tutor,
  selected,
  playing,
  onSelect,
  onPlay,
}: {
  tutor: Tutor;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onPlay: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 transition-[border-color,background-color] duration-150 ${
        selected ? "border-sky-400 bg-sky-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-600"
      }`}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="flex flex-1 items-center gap-3 text-left">
        <Portrait tutor={tutor} size={56} />
        <span>
          <span className="block text-sm font-semibold text-slate-100">{tutor.name}</span>
          <span className="block text-xs text-slate-400">{tutor.tagline}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Hear ${tutor.name}'s voice`}
        aria-pressed={playing}
        className={`grid h-8 w-8 place-items-center rounded-full transition-colors ${
          playing ? "bg-sky-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
        }`}
      >
        <Volume2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function Transcript({ captions, tutors }: { captions: Caption[]; tutors: Tutor[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [captions]);
  return (
    <div aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs leading-relaxed">
      {captions.length === 0 && <p className="text-slate-500">Captions appear here.</p>}
      {captions.map((c) => (
        <p key={c.id} className="text-slate-200">
          <span className={c.who === "tutor" ? "font-semibold text-sky-300" : "font-semibold text-emerald-300"}>
            {c.who === "tutor" ? tutors.find((t) => t.tutor_id === c.tutorId)?.name ?? "Tutor" : "You"}:
          </span>{" "}
          {c.text}
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}

export default function TutorPage() {
  const call = useAvatarCall();
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState<string>();
  const sample = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    listTutors(ctl.signal).then(
      (t) => {
        setTutors(t);
        setPicked((p) => p ?? t[0]?.tutor_id);
      },
      (e) => {
        if (!ctl.signal.aborted) setLoadError(`Couldn't load tutors (${e instanceof Error ? e.message : e}). Is the backend running?`);
      }
    );
    return () => {
      ctl.abort();
      sample.current?.pause();
    };
  }, []);

  const playSample = (id: string) => {
    sample.current?.pause();
    if (playing === id) return setPlaying(undefined);
    const a = new Audio(voiceSample(id));
    a.onended = () => setPlaying(undefined);
    sample.current = a;
    setPlaying(id);
    void a.play().catch(() => setPlaying(undefined));
  };

  const join = () => {
    if (!picked) return;
    sample.current?.pause();
    setPlaying(undefined);
    setExpanded(false);
    void call.start(picked);
  };

  const inCall = call.status === "connecting" || call.status === "live";
  const activeId = call.activeTutorId ?? picked;
  const active = tutors.find((t) => t.tutor_id === activeId);
  const switching = tutors.find((t) => t.tutor_id === call.switchingTo);

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    call.sendText(draft.trim());
    setDraft("");
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <GraduationCap className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">ScholarTwin Live Tutor</h1>
            <p className="text-[11px] text-slate-400">Face-to-face lessons with an AI avatar</p>
          </div>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-slate-100">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Workspace
        </Link>
      </header>

      {!inCall ? (
        <main className="mx-auto w-full max-w-xl space-y-5 overflow-y-auto px-4 py-10">
          <h2 className="text-lg font-semibold">Choose your tutor</h2>
          {loadError && <p role="alert" className="text-sm text-rose-400">{loadError}</p>}
          <div className="grid gap-3">
            {tutors.map((t) => (
              <TutorCard
                key={t.tutor_id}
                tutor={t}
                selected={t.tutor_id === picked}
                playing={playing === t.tutor_id}
                onSelect={() => setPicked(t.tutor_id)}
                onPlay={() => playSample(t.tutor_id)}
              />
            ))}
          </div>
          {call.status === "error" && <p role="alert" className="text-sm text-rose-400">{call.error}</p>}
          <button
            type="button"
            disabled={!picked}
            onClick={join}
            className="w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-[transform,background-color] duration-150 ease-out hover:bg-sky-400 active:scale-[0.98] disabled:opacity-50"
          >
            Join lesson
          </button>
          <p className="text-xs text-slate-500">Your microphone is used for the conversation. You can switch tutor during the call.</p>
        </main>
      ) : (
        <main
          className={`grid min-h-0 flex-1 grid-cols-1 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none ${
            expanded ? "lg:grid-cols-[560px_1fr]" : "lg:grid-cols-[300px_1fr]"
          }`}
        >
          {/* Left pane: tutor window, transcript, controls (same place as the workspace's avatar dock) */}
          <aside className="flex min-h-0 flex-col gap-3 border-b border-slate-800 bg-slate-900/40 p-4 lg:border-b-0 lg:border-r">
            <figure
              className={`relative mx-auto aspect-square w-full overflow-hidden rounded-2xl bg-slate-900 ring-2 transition-[box-shadow,max-width] duration-300 ease-out motion-reduce:transition-none ${
                expanded ? "max-w-[512px]" : "max-w-[268px]"
              } ${call.tutorSpeaking ? "ring-sky-400" : "ring-slate-800"}`}
            >
              {call.avatarVideo ? (
                <AvatarVideo track={call.avatarVideo} label={`${active?.name ?? "Tutor"}, your tutor`} />
              ) : (
                <div className="relative h-full w-full">
                  {active && <Image src={portrait(active.tutor_id)} alt="" fill sizes="512px" className="object-cover opacity-40 blur-[2px]" />}
                  <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-200">
                    <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                    {active ? `${active.name} is joining…` : "Connecting…"}
                  </p>
                </div>
              )}
              <figcaption className="absolute left-2 top-2 rounded-md bg-slate-950/70 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
                {active?.name ?? "Tutor"}
                {call.tutorSpeaking && <span className="ml-1.5 text-sky-300">· speaking</span>}
              </figcaption>
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-label={expanded ? "Shrink tutor window" : "Expand tutor window"}
                className="absolute right-2 top-2 hidden h-7 w-7 place-items-center rounded-md bg-slate-950/70 text-slate-200 backdrop-blur transition-colors hover:bg-slate-800 lg:grid"
              >
                {expanded ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </figure>

            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Repeat className="h-3.5 w-3.5" aria-hidden /> Switch tutor
              </h2>
              {switching && <span role="status" className="text-[11px] text-slate-400">Handing over to {switching.name}…</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {tutors.map((t) => {
                const isActive = t.tutor_id === activeId;
                return (
                  <button
                    key={t.tutor_id}
                    type="button"
                    disabled={isActive || !!call.switchingTo || call.status !== "live"}
                    aria-current={isActive}
                    onClick={() => call.switchTutor(t.tutor_id)}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                      isActive ? "border-sky-400 bg-sky-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-600 disabled:opacity-60"
                    }`}
                  >
                    <Portrait tutor={t} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{t.name}</span>
                      <span className="block truncate text-[10px] text-slate-400">{isActive ? "Teaching now" : t.tagline}</span>
                    </span>
                    {call.switchingTo === t.tutor_id && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-label="switching" />}
                  </button>
                );
              })}
            </div>

            <Transcript captions={call.captions} tutors={tutors} />

            <form onSubmit={onSend} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void call.toggleMic()}
                aria-pressed={call.mic}
                aria-label={call.mic ? "Mute microphone" : "Unmute microphone"}
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
                  call.mic ? "bg-slate-800 hover:bg-slate-700" : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                }`}
              >
                {call.mic ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Or type a question…"
                aria-label="Type a message to your tutor"
                className="h-9 min-w-0 flex-1 rounded-full border border-slate-800 bg-slate-950 px-3 text-xs outline-none focus:border-sky-500"
              />
              <button type="submit" aria-label="Send" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 hover:bg-slate-700">
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </form>
            <button
              type="button"
              onClick={call.end}
              className="flex h-9 items-center justify-center gap-2 rounded-full bg-rose-600 text-sm font-semibold transition-colors hover:bg-rose-500"
            >
              <PhoneOff className="h-4 w-4" aria-hidden /> Leave lesson
            </button>
          </aside>

          {/* Centre: whiteboard */}
          <section className="flex min-h-[420px] flex-col p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Whiteboard</h2>
              <span className="text-[11px] text-slate-500">Draw, write and circle what you want explained</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-800">
              <LessonBoard />
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
