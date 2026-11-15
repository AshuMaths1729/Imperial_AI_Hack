"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { AlertTriangle, ArrowRight, Check, Mic, Pause, Play, Plus, Upload, Video, X } from "lucide-react";
import { createTrack, type Track, type Tutor } from "./api";
import { AddMaterial } from "./AddMaterial";
import { NoTrackProgress, TrackProgress } from "./TrackProgress";
import { GlassSelect } from "@/components/GlassSelect";
import { MODULES } from "@/modules";
import { tutorPortrait, voiceSampleFor } from "../media";

/** Pre-join mic/camera check. Started by a click (no surprise permission prompt) and released on unmount so LiveKit can take the devices. */
function DeviceCheck() {
  const [stream, setStream] = useState<MediaStream>();
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!stream) return;
    if (videoRef.current) videoRef.current.srcObject = stream;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
      stream.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const startCheck = async () => {
    setErr(undefined);
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ audio: true, video: true }));
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setErr(
        name === "NotFoundError"
          ? "No microphone or camera was found. Connect one, or join anyway and type to your tutor."
          : name === "NotReadableError"
            ? "Another app is using your microphone or camera. Close it and try again."
            : "Allow the microphone and camera for this site in your browser, then check again."
      );
    }
  };

  const bars = 8;
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Video className="st-bob h-6 w-6 text-[var(--text-muted)]" aria-hidden />
            <button
              type="button"
              onClick={startCheck}
              className="apple-press apple-focus rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent)] hover:border-[var(--accent)]"
            >
              Check mic & camera
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2" aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}>
        <Mic className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden />
        <div className="flex flex-1 gap-1">
          {Array.from({ length: bars }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-75 ${
                stream && level * bars > i ? "bg-[var(--accent)]" : "bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]"
              }`}
            />
          ))}
        </div>
      </div>
      {err && <p className="text-xs text-[var(--status-contradict)]">{err}</p>}
    </div>
  );
}

type Props = {
  tutors: Tutor[];
  tracks: Track[];
  tutorId: string;
  trackId: string;
  onTutor: (id: string) => void;
  onTrack: (id: string) => void;
  onTracksChange: (tracks: Track[]) => void;
  onJoin: () => void;
  error?: string;
  loadError?: string;
};

/** One tutor as a portrait card: the card is the radio; the "Hear …" voice button sits over the portrait but beside
    the radio in the DOM (never nested inside another button), so playing a sample never selects the tutor. */
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
  const [style, ...rest] = tutor.style_prompt.split(":");
  const src = tutorPortrait(tutor);
  const hasSample = !!voiceSampleFor(tutor.tutor_id);
  return (
    <div
      className={`group relative rounded-[22px] transition-[box-shadow,translate] duration-300 ease-[cubic-bezier(0.3,1.4,0.5,1)] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 ${
        selected ? "shadow-[0_0_0_2px_var(--accent),0_0_0_6px_var(--accent-soft)]" : ""
      }`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={`${tutor.name}, ${style.trim()}`}
        onClick={onSelect}
        // Phones: a row (portrait left, words right) so three tutors stack compactly; from sm: portrait on top.
        className="apple-card st-sheen apple-press apple-focus relative flex h-full w-full items-start gap-3 overflow-hidden rounded-[22px] border p-2 text-left sm:flex-col sm:items-stretch sm:gap-2.5"
      >
        <span className="relative block aspect-square w-[92px] shrink-0 overflow-hidden rounded-2xl bg-[var(--bg-surface-muted)] sm:w-full">
          {src ? (
            <Image
              src={src}
              alt=""
              fill
              loading="eager" // above the fold: the lobby's largest paint
              sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 92px"
              // Square webcam-style frames: keep the upper part, so hair never touches the edge.
              className="object-cover object-[50%_30%] transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <span aria-hidden className="apple-display grid h-full w-full place-items-center text-4xl font-semibold text-[var(--text-secondary)]">
              {tutor.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          {selected && (
            <span aria-hidden className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] shadow-md">
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="block min-w-0 pt-1 sm:px-1.5 sm:pb-1.5 sm:pt-0">
          <span className="block text-base font-medium leading-tight text-[var(--text-primary)]">{tutor.name}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-[var(--text-secondary)] first-letter:uppercase">{style.trim()}</span>
          {rest.length > 0 && (
            <span title={rest.join(":").trim()} className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)] first-letter:uppercase sm:line-clamp-4">
              {rest.join(":").trim()}
            </span>
          )}
        </span>
      </button>
      {hasSample && (
        // Same box as the portrait (the card's 8px padding), so the pill sits on its lower-left corner.
        <div className="pointer-events-none absolute left-2 top-2 aspect-square w-[92px] sm:right-2 sm:w-auto">
          <button
            type="button"
            onClick={onPlay}
            aria-pressed={playing}
            aria-label={`Hear ${tutor.name}'s voice`}
            title={`Hear ${tutor.name}'s voice`}
            className="apple-glass-elevated apple-press apple-focus pointer-events-auto absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-full border p-1 text-[11px] font-semibold text-[var(--text-primary)] sm:bottom-2 sm:left-2 sm:pr-2.5"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
              {playing ? <Pause className="h-2.5 w-2.5" fill="currentColor" aria-hidden /> : <Play className="ml-px h-2.5 w-2.5" fill="currentColor" aria-hidden />}
            </span>
            <span className="max-sm:hidden">Hear {tutor.name}</span>
          </button>
        </div>
      )}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const panelHeading ="apple-heading text-xl font-normal tracking-[-0.02em] text-[var(--text-primary)]";
const quietBtn =
  "apple-press apple-focus inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface-muted)] font-medium text-[var(--text-primary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:text-[var(--text-muted)] disabled:hover:text-[var(--text-muted)]";
const alertBox =
  "st-shake flex items-start gap-2 rounded-2xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3 py-2 text-xs text-[var(--status-contradict)]";

export function Lobby({ tutors, tracks, tutorId, trackId, onTutor, onTrack, onTracksChange, onJoin, error, loadError }: Props) {
  const [newTitle, setNewTitle] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string>();
  const [adding, setAdding] = useState(false);
  const track = tracks.find((t) => t.track_id === trackId);
  const tutor = tutors.find((t) => t.tutor_id === tutorId);
  const ready = !!tutor && !!track;
  // "Hear …" voice samples: one plays at a time, and leaving the lobby (joining) stops it.
  const [playing, setPlaying] = useState<string>();
  const sample = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => sample.current?.pause(), []);
  const playSample = (id: string) => {
    sample.current?.pause();
    if (playing === id) return setPlaying(undefined);
    const src = voiceSampleFor(id);
    if (!src) return;
    const a = new Audio(src);
    a.onended = () => setPlaying(undefined);
    sample.current = a;
    setPlaying(id);
    void a.play().catch(() => setPlaying(undefined));
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle?.trim();
    if (!title) return;
    try {
      const t = await createTrack(title);
      onTracksChange([...tracks, t]);
      onTrack(t.track_id);
      setNewTitle(null);
      setCreateErr(undefined);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-3 pb-10 sm:px-5">
      {/* Straight on the landscape: ink by day, pale by dusk (on-scene). */}
      <div className="st-fade-up grid grid-cols-1 gap-2.5 px-1 pb-6 pt-8 sm:pb-7 sm:pt-12">
        <p className="on-scene font-mono text-[11px] font-medium uppercase tracking-[0.12em]">{MODULES.lecture.name}</p>
        <h2 className="st-display on-scene text-[clamp(34px,5.4vw,60px)]">
          Learn it face to face. <span className="on-scene-soft">At your pace.</span>
        </h2>
        <p className="on-scene max-w-[38rem] text-[15px] font-medium leading-relaxed sm:text-base">
          Pick a tutor and a topic. They teach with slides and a whiteboard, answer out loud, and pick up next time where you stopped.
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section aria-labelledby="tutor-heading" className="apple-sheet st-fade-up grid grid-cols-1 min-w-0 gap-5 rounded-[26px] p-3.5 sm:p-5">
          <div className="grid grid-cols-1 gap-3">
            <h3 id="tutor-heading" className={panelHeading}>
              Choose your tutor
            </h3>
            {loadError && (
              <p role="alert" className={alertBox}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {loadError}
              </p>
            )}
            <div role="radiogroup" aria-labelledby="tutor-heading" className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
              {tutors.map((t) => (
                <TutorCard
                  key={t.tutor_id}
                  tutor={t}
                  selected={t.tutor_id === tutorId}
                  playing={playing === t.tutor_id}
                  onSelect={() => onTutor(t.tutor_id)}
                  onPlay={() => playSample(t.tutor_id)}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <span aria-hidden className="text-[13px] font-medium text-[var(--text-secondary)]">
              Topic
            </span>
            <div className="flex gap-2">
              <GlassSelect
                label="Topic"
                value={trackId}
                placeholder="Choose a topic…"
                options={tracks.map((t) => ({ value: t.track_id, label: t.title }))}
                onChange={onTrack}
                className="flex-1"
              />
              <button
                type="button"
                aria-expanded={newTitle !== null}
                onClick={() => setNewTitle(newTitle === null ? "" : null)}
                className={`${quietBtn} px-3.5 text-xs`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> New topic
              </button>
            </div>
            {newTitle !== null && (
              <form onSubmit={create} className="flex gap-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  aria-label="New topic title"
                  placeholder="e.g. Linear Algebra"
                  className="apple-focus min-w-0 flex-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
                />
                <button type="submit" disabled={!newTitle.trim()} className={newTitle.trim() ? "apple-tint apple-press apple-focus shrink-0 rounded-full px-4 text-xs font-semibold" : `${quietBtn} px-4 text-xs`}>
                  Create
                </button>
              </form>
            )}
            {createErr && (
              <p role="alert" className={alertBox}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {createErr}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {error && (
              <p role="alert" className={alertBox}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onJoin}
                disabled={!ready}
                // Disabled stays legible: a quiet well with muted ink instead of a faded tint.
                className={
                  ready
                    ? "apple-tint st-sheen apple-press apple-focus relative inline-flex items-center gap-2 overflow-hidden rounded-full px-5 py-3 text-sm font-semibold"
                    : `${quietBtn} px-5 py-3 text-sm`
                }
              >
                {tutor ? `Start lesson with ${tutor.name}` : "Start lesson"}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setAdding((a) => !a)}
                disabled={!track}
                aria-expanded={adding && !!track}
                aria-controls="add-material"
                title={track ? undefined : "Pick a topic first"}
                className={`${quietBtn} px-4 py-3 text-sm`}
              >
                {adding && track ? <X className="h-4 w-4" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                Add your own slides
              </button>
            </div>
            {!ready && (
              <p className="text-xs text-[var(--text-muted)]">
                {!tutor && !track ? "Choose a tutor and a topic to start." : !tutor ? "Choose a tutor to start." : "Choose a topic to start."}
              </p>
            )}
            {adding && track && (
              <div id="add-material" className="st-fade-up grid grid-cols-1 gap-2.5 rounded-[20px] border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">Add to {track.title}</h4>
                  <span className="text-xs text-[var(--text-muted)]">
                    {plural(track.knowledge_points.length, "knowledge point")} · {plural(track.materials.length, "material")}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  A PDF of your slides or notes, or a paper&apos;s URL. The tutor builds the lesson from it.
                </p>
                <AddMaterial
                  key={track.track_id}
                  trackId={track.track_id}
                  onAdded={(t) => onTracksChange(tracks.map((x) => (x.track_id === t.track_id ? t : x)))}
                />
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 min-w-0 gap-4">
          {track ? <TrackProgress key={track.track_id} track={track} /> : <NoTrackProgress />}
          <section aria-labelledby="devices-heading" className="apple-sheet st-fade-up grid grid-cols-1 gap-3 rounded-[26px] p-4 sm:p-5" style={{ animationDelay: "140ms" }}>
            <h3 id="devices-heading" className="text-sm font-semibold text-[var(--text-primary)]">
              Before you join
            </h3>
            <DeviceCheck />
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Your camera is only shown to you. The tutor hears your voice and sees what you share.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
