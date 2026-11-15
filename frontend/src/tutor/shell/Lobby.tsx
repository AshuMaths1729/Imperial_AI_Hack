"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Mic, Plus, Video } from "lucide-react";
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
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Video className="st-bob h-6 w-6 text-[var(--text-muted)]" aria-hidden />
            <button
              type="button"
              onClick={startCheck}
              className="apple-press apple-focus rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent)] hover:opacity-90"
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
                stream && level * bars > i ? "bg-[var(--accent)]" : "bg-[var(--bg-surface-muted)]"
              }`}
            />
          ))}
        </div>
      </div>
      {err && <p className="text-[11px] text-[var(--status-contradict)]">{err}</p>}
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
    <div className="mx-auto my-auto grid w-full max-w-5xl gap-2.5 px-2 py-4 sm:px-3 md:grid-cols-[1fr_340px]">
      <div className="apple-sheet st-fade-up min-w-0 space-y-8 rounded-[22px] p-4 sm:p-5">
        <section>
          <h2 id="tutor-heading" className="apple-label mb-3 text-[10px] font-semibold uppercase text-[var(--text-muted)]">
            Choose your tutor
          </h2>
          {loadError && (
            <p role="alert" className="st-shake mb-3 flex items-start gap-2 rounded-2xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3 py-2 text-xs text-[var(--status-contradict)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {loadError}
            </p>
          )}
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
                  className={`apple-press apple-focus group flex flex-col items-start gap-3 rounded-2xl border p-4 text-left ${
                    selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-11 w-11 place-items-center rounded-full text-sm font-semibold transition-colors ${
                      selected ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-surface-muted)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {initials(t.name)}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">{t.name}</span>
                    <span className="block text-xs font-medium text-[var(--accent)] first-letter:uppercase">{style.trim()}</span>
                    {rest.length > 0 && <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">{rest.join(":").trim()}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">Learning track</h2>
          <div className="flex gap-2">
            <select
              aria-label="Learning track"
              value={trackId}
              onChange={(e) => onTrack(e.target.value)}
              className="apple-focus min-w-0 flex-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-border)] focus:outline-none"
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
              className="apple-press apple-focus flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--accent)]"
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
                className="apple-focus min-w-0 flex-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
              />
              <button type="submit" className="apple-tint apple-press apple-focus shrink-0 rounded-full px-4 text-xs font-semibold">
                Create
              </button>
            </form>
          )}
          {createErr && <p role="alert" className="text-xs text-[var(--status-contradict)]">{createErr}</p>}
          {track && (
            <div className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
              <p className="text-xs text-[var(--text-muted)]">
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

      <aside className="apple-sheet st-fade-up space-y-4 rounded-[22px] p-4 md:self-start" style={{ animationDelay: "80ms" }}>
        <DeviceCheck />
        {error && (
          <p role="alert" className="st-shake flex items-start gap-2 rounded-2xl border border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] px-3 py-2 text-xs text-[var(--status-contradict)]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
        <button
          type="button"
          onClick={onJoin}
          disabled={!tutorId || !trackId}
          className="apple-tint apple-press apple-focus flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          Join lesson
        </button>
        <p className="text-center text-[11px] text-[var(--text-muted)]">Your camera is only shown to you. The tutor hears your voice and sees what you share.</p>
      </aside>
    </div>
  );
}
