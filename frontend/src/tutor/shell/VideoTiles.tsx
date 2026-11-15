"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { LocalVideoTrack, RemoteVideoTrack } from "livekit-client";
import Image from "next/image";
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

/** Round tutor face: the tutor's portrait, or initials when there is none. The caller sizes it (h-/w- classes). */
export function TutorFace({ name, src, className = "" }: { name: string; src?: string; className?: string }) {
  return (
    <span aria-hidden className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold ${className}`}>
      {src ? <Image src={src} alt="" fill sizes="96px" className="object-cover" /> : initials(name)}
    </span>
  );
}

type Props = {
  tutorName: string;
  /** The tutor's portrait (media.tutorPortrait), shown until the avatar's video arrives or for a voice-only tutor. */
  tutorPortrait?: string;
  connecting: boolean;
  avatarVideo?: RemoteVideoTrack;
  tutorSpeaking: boolean;
  selfVideo?: LocalVideoTrack;
  cam: boolean;
  mic: boolean;
  /** Where the lesson is, shown beside the "Tutor" label (e.g. "Slide 3 of 7"). */
  where?: string;
};

export function VideoTiles({ tutorName, tutorPortrait, connecting, avatarVideo, tutorSpeaking, selfVideo, cam, mic, where }: Props) {
  return (
    <section aria-label="Tutor" className="apple-sheet st-fade-up shrink-0 rounded-[22px] p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="apple-heading text-sm font-semibold">Tutor</h2>
        {where && <span className="font-mono text-[11px] text-[var(--text-muted)]">{where}</span>}
      </div>
      <div className="relative">
        <figure
          className={`relative aspect-video overflow-hidden rounded-2xl bg-[var(--bg-surface-muted)] ring-2 transition-[box-shadow] duration-200 ${
            tutorSpeaking ? "ring-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]" : "ring-transparent"
          }`}
        >
          {avatarVideo ? (
            <TrackVideo track={avatarVideo} label={`${tutorName}, your tutor`} />
          ) : (
            // Voice-only fallback (no avatar, or avatar still starting): a ring that breathes while the tutor talks.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_40%,var(--accent-soft),transparent_70%)]">
              <div className="relative grid h-16 w-16 place-items-center">
                <span
                  aria-hidden
                  className={`absolute inset-0 rounded-full border-2 border-[var(--accent-border)] ${
                    tutorSpeaking || connecting ? "animate-ping motion-reduce:animate-none" : ""
                  }`}
                />
                <TutorFace name={tutorName} src={tutorPortrait} className="h-16 w-16 bg-[var(--accent)] text-lg text-[var(--accent-fg)]" />
              </div>
              <span className="text-xs text-[var(--text-secondary)]">{connecting ? `Waiting for ${tutorName} to join…` : "Voice only"}</span>
            </div>
          )}
          {!connecting && (
            <span className="apple-glass absolute left-2 top-2 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-support)]" aria-hidden /> Live
            </span>
          )}
          <figcaption className="apple-glass absolute bottom-2 left-2 rounded-full border px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
            {tutorName}
            {tutorSpeaking && <span className="ml-1.5 text-[var(--accent)]">· speaking</span>}
          </figcaption>
        </figure>
        {/* self-view, shown only to you */}
        <figure className="absolute bottom-2 right-2 aspect-video w-[30%] min-w-24 overflow-hidden rounded-xl bg-[var(--bg-surface-solid)] shadow-[var(--shadow-card)] ring-1 ring-[var(--glass-rim)]">
          {cam && selfVideo ? (
            <TrackVideo track={selfVideo} mirror label="Your camera (only you see this)" />
          ) : (
            <div className="grid h-full w-full place-items-center text-[10px] text-[var(--text-muted)]">Camera off</div>
          )}
          <figcaption className="apple-glass absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-[var(--text-primary)]">
            {!mic && <MicOff className="h-3 w-3 text-[var(--status-contradict)]" aria-label="muted" />}
            You
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
