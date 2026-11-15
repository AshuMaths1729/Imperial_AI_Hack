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
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
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
  /** Where the lesson is, shown beside the "Tutor" label (e.g. "Slide 3 of 7"). */
  where?: string;
};

export function VideoTiles({ tutorName, connecting, avatarVideo, tutorSpeaking, selfVideo, cam, mic, where }: Props) {
  return (
    <section aria-label="Tutor" className="st-glass shrink-0 rounded-[20px] p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold">Tutor</h2>
        {where && <span className="font-mono text-[11px] text-[var(--st-muted)]">{where}</span>}
      </div>
      <div className="relative">
        <figure
          className={`relative aspect-video overflow-hidden rounded-2xl bg-[#26352c] ring-2 transition-[box-shadow] duration-200 ${
            tutorSpeaking ? "ring-[var(--st-accent)] shadow-[0_0_0_4px_rgba(30,74,51,0.15)]" : "ring-transparent"
          }`}
        >
          {avatarVideo ? (
            <TrackVideo track={avatarVideo} label={`${tutorName}, your tutor`} />
          ) : (
            // Voice-only fallback (no avatar, or avatar still starting): a ring that breathes while the tutor talks.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_40%,#3c5a47,#1f2f26_70%)]">
              <div className="relative grid h-16 w-16 place-items-center">
                <span
                  aria-hidden
                  className={`absolute inset-0 rounded-full border-2 border-[#cfe3d3]/60 ${
                    tutorSpeaking || connecting ? "animate-ping motion-reduce:animate-none" : ""
                  }`}
                />
                <span className="grid h-16 w-16 place-items-center rounded-full bg-[#f2f6f0] text-lg font-semibold text-[var(--st-accent)]">
                  {initials(tutorName)}
                </span>
              </div>
              <span className="text-xs text-[#d8e4da]">{connecting ? `Waiting for ${tutorName} to join…` : "Voice only"}</span>
            </div>
          )}
          {!connecting && (
            <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-[#13201a]/70 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" aria-hidden /> Live
            </span>
          )}
          <figcaption className="absolute bottom-2 left-2 rounded-full bg-[#13201a]/70 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur">
            {tutorName}
            {tutorSpeaking && <span className="ml-1.5 text-[#bfe3c9]">· speaking</span>}
          </figcaption>
        </figure>
        {/* self-view, shown only to you */}
        <figure className="absolute bottom-2 right-2 aspect-video w-[30%] min-w-24 overflow-hidden rounded-xl bg-[#3a4a40] shadow-lg ring-1 ring-white/30">
          {cam && selfVideo ? (
            <TrackVideo track={selfVideo} mirror label="Your camera (only you see this)" />
          ) : (
            <div className="grid h-full w-full place-items-center text-[10px] text-[#d8e4da]">Camera off</div>
          )}
          <figcaption className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-[#13201a]/70 px-1.5 py-0.5 text-[10px] text-white">
            {!mic && <MicOff className="h-3 w-3 text-[#ffb4a1]" aria-label="muted" />}
            You
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
