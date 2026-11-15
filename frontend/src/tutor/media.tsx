"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import type { RemoteVideoTrack } from "livekit-client";
import type { Tutor } from "./api";

// Portraits are frames grabbed from each live Synthesia avatar; voice samples come from ElevenLabs Voice Design.
export const portrait = (id: string) => `/tutors/${id}.png`;
export const voiceSample = (id: string) => `/tutors/voices/${id}.mp3`;

/** The avatar's LiveKit video (512×512 from Synthesia); size it at ≤512 css px to stay sharp. */
export function AvatarVideo({ track, label }: { track: RemoteVideoTrack; label: string }) {
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    track.attach(v);
    return () => void track.detach(v);
  }, [track]);
  return <video ref={el} aria-label={label} autoPlay playsInline muted className="h-full w-full object-cover" />;
}

export function Portrait({ tutor, size }: { tutor: Tutor; size: number }) {
  return (
    <Image
      src={portrait(tutor.tutor_id)}
      alt={`${tutor.name}, ${tutor.tagline}`}
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover ring-1 ring-[var(--border-strong)]"
    />
  );
}
