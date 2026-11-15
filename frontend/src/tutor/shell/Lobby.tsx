"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mic, Plus, Video } from "lucide-react";
import { createTrack, type Track, type Tutor } from "./api";
import { AddMaterial } from "./AddMaterial";
import { initials } from "./VideoTiles";

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
      setErr(e instanceof Error ? `${e.name}: allow the microphone and camera for this site.` : String(e));
    }
  };

  const bars = 8;
  return (
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#26352c]">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Video className="h-6 w-6 text-[#d8e4da]" aria-hidden />
            <button
              type="button"
              onClick={startCheck}
              className="rounded-full bg-[#f2f6f0] px-3.5 py-1.5 text-xs font-medium text-[var(--st-accent)] transition-[transform,background-color] duration-150 ease-out hover:bg-white active:scale-[0.97]"
            >
              Check mic & camera
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2" aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}>
        <Mic className="h-3.5 w-3.5 text-[var(--st-muted)]" aria-hidden />
        <div className="flex flex-1 gap-1">
          {Array.from({ length: bars }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-75 ${
                stream && level * bars > i ? "bg-[var(--st-accent)]" : "bg-black/10"
              }`}
            />
          ))}
        </div>
      </div>
      {err && <p className="text-[11px] text-[var(--st-danger)]">{err}</p>}
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

export function Lobby({ tutors, tracks, tutorId, trackId, onTutor, onTrack, onTracksChange, onJoin, error, loadError }: Props) {
  const [newTitle, setNewTitle] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<string>();
  const track = tracks.find((t) => t.track_id === trackId);

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
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-3 py-4 md:grid-cols-[1fr_360px]">
      <div className="st-glass space-y-8 rounded-[20px] p-5">
        <section>
          <h2 id="tutor-heading" className="mb-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--st-muted)]">
            Choose your tutor
          </h2>
          {loadError && <p className="mb-3 text-xs text-[var(--st-danger)]">{loadError}</p>}
          <div role="radiogroup" aria-labelledby="tutor-heading" className="grid gap-3 sm:grid-cols-3">
            {tutors.map((t) => {
              const [style, ...rest] = t.style_prompt.split(":");
              const selected = t.tutor_id === tutorId;
              return (
                <button
                  key={t.tutor_id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onTutor(t.tutor_id)}
                  className={`group flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-[transform,border-color,background-color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-[var(--st-accent)] ${
                    selected ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)]" : "border-[var(--st-line)] bg-[var(--st-surface)] hover:border-[var(--st-line-strong)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-11 w-11 place-items-center rounded-full text-sm font-semibold transition-colors ${
                      selected ? "bg-[var(--st-accent)] text-[var(--st-accent-fg)]" : "bg-black/5 text-[var(--st-text-2)]"
                    }`}
                  >
                    {initials(t.name)}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{t.name}</span>
                    <span className="block text-xs font-medium text-[var(--st-accent)] first-letter:uppercase">{style.trim()}</span>
                    {rest.length > 0 && <span className="mt-1 block text-xs leading-relaxed text-[var(--st-muted)]">{rest.join(":").trim()}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--st-muted)]">Learning track</h2>
          <div className="flex gap-2">
            <select
              aria-label="Learning track"
              value={trackId}
              onChange={(e) => onTrack(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 py-2 text-sm text-[var(--st-text)] focus:border-[var(--st-accent)] focus:outline-none"
            >
              <option value="">Choose a track…</option>
              {tracks.map((t) => (
                <option key={t.track_id} value={t.track_id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setNewTitle(newTitle === null ? "" : null)}
              className="flex items-center gap-1 rounded-xl border border-[var(--st-line-strong)] px-3 text-xs font-medium text-[var(--st-text-2)] transition-colors hover:border-[var(--st-accent)]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> New track
            </button>
          </div>
          {newTitle !== null && (
            <form onSubmit={create} className="flex gap-2">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                aria-label="New track title"
                placeholder="e.g. Linear Algebra"
                className="flex-1 rounded-xl border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 py-2 text-sm text-[var(--st-text)] placeholder-[var(--st-muted)] focus:border-[var(--st-accent)] focus:outline-none"
              />
              <button type="submit" className="rounded-xl bg-black/5 px-3 text-xs font-medium text-[var(--st-text)] hover:bg-black/10">
                Create
              </button>
            </form>
          )}
          {createErr && <p className="text-xs text-[var(--st-danger)]">{createErr}</p>}
          {track && (
            <div className="space-y-2 rounded-xl border border-[var(--st-line)] bg-[var(--st-surface)] p-3">
              <p className="text-xs text-[var(--st-muted)]">
                {track.knowledge_points.length} knowledge points · {track.materials.length} materials
              </p>
              <AddMaterial
                key={track.track_id}
                trackId={track.track_id}
                onAdded={(t) => onTracksChange(tracks.map((x) => (x.track_id === t.track_id ? t : x)))}
              />
            </div>
          )}
        </section>
      </div>

      <aside className="st-glass space-y-4 rounded-[20px] p-4 md:self-start">
        <DeviceCheck />
        {error && (
          <p role="alert" className="rounded-xl border border-[var(--st-danger)]/30 bg-[var(--st-danger-soft)] px-3 py-2 text-xs text-[var(--st-danger)]">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onJoin}
          disabled={!tutorId || !trackId}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--st-accent)] py-3 text-sm font-semibold text-[var(--st-accent-fg)] transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-[var(--st-accent-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          Join lesson
        </button>
        <p className="text-center text-[11px] text-[var(--st-muted)]">Your camera is only shown to you. The tutor hears your voice and sees what you share.</p>
      </aside>
    </div>
  );
}
