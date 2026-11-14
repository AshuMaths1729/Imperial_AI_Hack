"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";
import { MicOff } from "lucide-react";

/** Renders a LiveKit video track; the ref exposes the <video> element (ScreenCircle reads frames from it). */
export const TrackVideo = forwardRef<
  HTMLVideoElement | null,
  { track: LocalVideoTrack | RemoteVideoTrack; mirror?: boolean; fit?: "cover" | "contain"; label: string }
>(function TrackVideo({ track, mirror, fit = "cover", label }, ref) {
  const el = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => el.current!, []);
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    track.attach(v);
    return () => void track.detach(v);
  }, [track]);
  return (
    <video
      ref={el}
      aria-label={label}
      autoPlay
      playsInline
      muted
      className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} ${mirror ? "-scale-x-100" : ""}`}
    />
  );
});

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

type Props = {
  tutorName: string;
  connecting: boolean;
  avatarVideo?: RemoteVideoTrack;
  tutorSpeaking: boolean;
  selfVideo?: LocalVideoTrack;
  cam: boolean;
  mic: boolean;
};

export function VideoTiles({ tutorName, connecting, avatarVideo, tutorSpeaking, selfVideo, cam, mic }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <figure
        className={`relative aspect-video overflow-hidden rounded-xl bg-slate-900 ring-2 transition-[box-shadow] duration-200 ${
          tutorSpeaking ? "ring-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.15)]" : "ring-slate-800"
        }`}
      >
        {avatarVideo ? (
          <TrackVideo track={avatarVideo} label={`${tutorName}, your tutor`} />
        ) : (
          // Voice-only fallback (no avatar, or avatar still starting): a ring that breathes while the tutor talks.
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_40%,rgba(56,189,248,0.12),transparent_60%)]">
            <div className="relative grid h-16 w-16 place-items-center">
              <span
                aria-hidden
                className={`absolute inset-0 rounded-full border-2 border-sky-400/60 ${
                  tutorSpeaking || connecting ? "animate-ping motion-reduce:animate-none" : ""
                }`}
              />
              <span className="grid h-16 w-16 place-items-center rounded-full bg-sky-500/15 text-lg font-semibold text-sky-300">
                {initials(tutorName)}
              </span>
            </div>
            <span className="text-xs text-slate-400">
              {connecting ? `Waiting for ${tutorName} to join…` : "Voice only"}
            </span>
          </div>
        )}
        <figcaption className="absolute bottom-2 left-2 rounded-md bg-slate-950/70 px-2 py-0.5 text-[11px] font-medium text-slate-100 backdrop-blur">
          {tutorName}
          {tutorSpeaking && <span className="ml-1.5 text-sky-300">· speaking</span>}
        </figcaption>
      </figure>

      <figure className="relative ml-auto aspect-video w-1/2 overflow-hidden rounded-lg bg-slate-900 ring-1 ring-slate-800">
        {cam && selfVideo ? (
          <TrackVideo track={selfVideo} mirror label="Your camera (only you see this)" />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-slate-500">Camera off</div>
        )}
        <figcaption className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] text-slate-200">
          {!mic && <MicOff className="h-3 w-3 text-rose-400" aria-label="muted" />}
          You
        </figcaption>
      </figure>
    </div>
  );
}
