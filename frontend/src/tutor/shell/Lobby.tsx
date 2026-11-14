"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mic, Plus, Video } from "lucide-react";
import { createTrack, type Track, type Tutor } from "./api";
import { AddMaterial } from "./AddMaterial";
import { DeckPrep } from "./DeckPrep";
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
      <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-800">
        {stream ? (
          <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Video className="h-6 w-6 text-slate-600" aria-hidden />
            <button
              type="button"
              onClick={startCheck}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-[transform,border-color] duration-150 ease-out hover:border-sky-500 active:scale-[0.97]"
            >
              Check mic & camera
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2" aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(level.toFixed(2))}>
        <Mic className="h-3.5 w-3.5 text-slate-500" aria-hidden />
        <div className="flex flex-1 gap-1">
          {Array.from({ length: bars }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-75 ${
                stream && level * bars > i ? "bg-emerald-400" : "bg-slate-800"
              }`}
            />
          ))}
        </div>
      </div>
      {err && <p className="text-[11px] text-rose-300">{err}</p>}
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
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 md:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        <section>
          <h2 id="tutor-heading" className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Choose your tutor
          </h2>
          {loadError && <p className="mb-3 text-xs text-rose-300">{loadError}</p>}
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
                  className={`group flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-[transform,border-color,background-color] duration-150 ease-out active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    selected ? "border-sky-500 bg-sky-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-600"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-11 w-11 place-items-center rounded-full text-sm font-semibold transition-colors ${
                      selected ? "bg-sky-500 text-slate-950" : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {initials(t.name)}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-slate-100">{t.name}</span>
                    <span className="block text-xs text-sky-300 first-letter:uppercase">{style.trim()}</span>
                    {rest.length > 0 && <span className="mt-1 block text-xs leading-relaxed text-slate-400">{rest.join(":").trim()}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Learning track</h2>
          <div className="flex gap-2">
            <select
              aria-label="Learning track"
              value={trackId}
              onChange={(e) => onTrack(e.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
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
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 text-xs font-medium text-slate-200 transition-colors hover:border-sky-500"
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
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
              <button type="submit" className="rounded-lg bg-slate-800 px-3 text-xs font-medium text-slate-100 hover:bg-slate-700">
                Create
              </button>
            </form>
          )}
          {createErr && <p className="text-xs text-rose-300">{createErr}</p>}
          {track && (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-400">
                {track.knowledge_points.length} knowledge points · {track.materials.length} materials
              </p>
              <AddMaterial
                trackId={track.track_id}
                onAdded={(t) => onTracksChange(tracks.map((x) => (x.track_id === t.track_id ? t : x)))}
              />
              <DeckPrep key={track.track_id} trackId={track.track_id} />
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 md:self-start">
        <DeviceCheck />
        {error && (
          <p role="alert" className="rounded-lg border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onJoin}
          disabled={!tutorId || !trackId}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 text-sm font-semibold text-slate-950 transition-[transform,background-color,opacity] duration-150 ease-out hover:bg-sky-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          Join lesson
        </button>
        <p className="text-center text-[11px] text-slate-500">Your camera is only shown to you. The tutor hears your voice and sees what you share.</p>
      </aside>
    </div>
  );
}
