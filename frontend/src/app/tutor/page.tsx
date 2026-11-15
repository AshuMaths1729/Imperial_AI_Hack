"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
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
import { AppHeader } from "@/components/AppHeader";

const LessonBoard = dynamic(() => import("@/tutor/LessonBoard"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-[var(--text-muted)]">Loading whiteboard…</div>,
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
      className={`apple-press flex items-center gap-3 rounded-2xl border p-3 ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]"
      }`}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="apple-focus flex flex-1 items-center gap-3 text-left">
        <Portrait tutor={tutor} size={56} />
        <span>
          <span className="block text-sm font-semibold text-[var(--text-primary)]">{tutor.name}</span>
          <span className="block text-xs text-[var(--text-muted)]">{tutor.tagline}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Hear ${tutor.name}'s voice`}
        aria-pressed={playing}
        className={`apple-press apple-focus grid h-8 w-8 place-items-center rounded-full ${
          playing
            ? "bg-[var(--accent)] text-[var(--accent-fg)]"
            : "bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
    <div aria-live="polite" className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-xs leading-relaxed">
      {captions.length === 0 && <p className="text-[var(--text-muted)]">Captions appear here.</p>}
      {captions.map((c) => (
        <p key={c.id} className="text-[var(--text-primary)]">
          <span className={c.who === "tutor" ? "font-semibold text-[var(--accent)]" : "font-semibold text-[var(--status-support)]"}>
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
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <AppHeader
        back={{ label: "Home", href: "/" }}
        icon={GraduationCap}
        title="Live Tutor"
        subtitle="Face-to-face lessons with an AI avatar"
        hideTutorLink
      />

      {!inCall ? (
        <main className="mx-auto w-full max-w-xl space-y-5 overflow-y-auto px-4 py-10">
          <h2 className="apple-heading st-fade-up text-lg font-semibold">Choose your tutor</h2>
          {loadError && <p role="alert" className="text-sm text-[var(--status-contradict)]">{loadError}</p>}
          <div className="grid gap-3">
            {tutors.map((t, i) => (
              <div key={t.tutor_id} className="st-fade-up" style={{ animationDelay: `${80 + i * 80}ms` }}>
                <TutorCard
                  tutor={t}
                  selected={t.tutor_id === picked}
                  playing={playing === t.tutor_id}
                  onSelect={() => setPicked(t.tutor_id)}
                  onPlay={() => playSample(t.tutor_id)}
                />
              </div>
            ))}
          </div>
          {call.status === "error" && <p role="alert" className="text-sm text-[var(--status-contradict)]">{call.error}</p>}
          <button
            type="button"
            disabled={!picked}
            onClick={join}
            className="apple-press apple-focus w-full rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            Join lesson
          </button>
          <p className="text-xs text-[var(--text-muted)]">Your microphone is used for the conversation. You can switch tutor during the call.</p>
        </main>
      ) : (
        <main
          className={`grid min-h-0 flex-1 grid-cols-1 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none ${
            expanded ? "lg:grid-cols-[560px_1fr]" : "lg:grid-cols-[300px_1fr]"
          }`}
        >
          {/* Left pane: tutor window, transcript, controls (same place as the workspace's avatar dock) */}
          <aside className="flex min-h-0 flex-col gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 lg:border-b-0 lg:border-r">
            <figure
              className={`relative mx-auto aspect-square w-full overflow-hidden rounded-2xl bg-[var(--bg-canvas)] ring-2 transition-[box-shadow,max-width] duration-300 ease-out motion-reduce:transition-none ${
                expanded ? "max-w-[512px]" : "max-w-[268px]"
              } ${call.tutorSpeaking ? "ring-[var(--accent)]" : "ring-[var(--border-subtle)]"}`}
            >
              {call.avatarVideo ? (
                <AvatarVideo track={call.avatarVideo} label={`${active?.name ?? "Tutor"}, your tutor`} />
              ) : (
                <div className="relative h-full w-full">
                  {active && <Image src={portrait(active.tutor_id)} alt="" fill sizes="512px" className="object-cover opacity-40 blur-[2px]" />}
                  <p role="status" className="absolute inset-0 flex items-center justify-center">
                    <span className="apple-glass flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-[var(--text-primary)]">
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                      {active ? `${active.name} is joining…` : "Connecting…"}
                    </span>
                  </p>
                </div>
              )}
              <figcaption className="apple-glass absolute left-2 top-2 rounded-lg border px-2 py-0.5 text-[11px] font-medium">
                {active?.name ?? "Tutor"}
                {call.tutorSpeaking && <span className="ml-1.5 text-[var(--accent)]">· speaking</span>}
              </figcaption>
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-label={expanded ? "Shrink tutor window" : "Expand tutor window"}
                className="apple-glass apple-press apple-focus absolute right-2 top-2 hidden h-7 w-7 place-items-center rounded-lg border text-[var(--text-primary)] lg:grid"
              >
                {expanded ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </figure>

            <div className="flex items-center justify-between">
              <h2 className="apple-label flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                <Repeat className="h-3.5 w-3.5" aria-hidden /> Switch tutor
              </h2>
              {switching && <span role="status" className="text-[11px] text-[var(--text-muted)]">Handing over to {switching.name}…</span>}
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
                    className={`apple-press apple-focus flex items-center gap-2 rounded-xl border p-2 text-left ${
                      isActive
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)] disabled:opacity-60"
                    }`}
                  >
                    <Portrait tutor={t} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-[var(--text-primary)]">{t.name}</span>
                      <span className="block truncate text-[10px] text-[var(--text-muted)]">{isActive ? "Teaching now" : t.tagline}</span>
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
                className={`apple-press apple-focus grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  call.mic
                    ? "bg-[var(--bg-surface-muted)] text-[var(--text-primary)]"
                    : "bg-[var(--status-contradict-soft)] text-[var(--status-contradict)]"
                }`}
              >
                {call.mic ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Or type a question…"
                aria-label="Type a message to your tutor"
                className="apple-focus h-9 min-w-0 flex-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent)]"
              />
              <button type="submit" aria-label="Send" className="apple-press apple-focus grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--bg-surface-muted)] text-[var(--text-primary)]">
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </form>
            <button
              type="button"
              onClick={call.end}
              className="apple-press apple-focus flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--status-contradict)] text-sm font-semibold text-[var(--status-contradict-fg)] hover:opacity-90"
            >
              <PhoneOff className="h-4 w-4" aria-hidden /> Leave lesson
            </button>
          </aside>

          {/* Centre: whiteboard */}
          <section className="flex min-h-[420px] flex-col p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="apple-label text-[11px] font-semibold uppercase text-[var(--text-muted)]">Whiteboard</h2>
              <span className="text-[11px] text-[var(--text-muted)]">Draw, write and circle what you want explained</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
              <LessonBoard />
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
