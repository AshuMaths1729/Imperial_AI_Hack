"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import type { RemoteVideoTrack } from "livekit-client";
import type { Tutor } from "./api";

// Portraits are frames grabbed from each live Synthesia avatar; voice samples come from ElevenLabs Voice Design.
export const portrait = (id: string) => `/tutors/${id}.png`;
export const voiceSample = (id: string) => `/tutors/voices/${id}.mp3`;

/* Synthesia avatar id → its portrait frame. Live-lesson tutors are one avatar per face with several
   teaching styles (kenji-visual, kenji-socratic, …), so their portrait follows the avatar, not the id. */
const AVATAR_PORTRAITS: Record<string, string> = {
  "7572faa9-15da-400d-8227-ef1ab8932523": "kenji-visual",
  "8788bef1-8020-46e0-a8f4-510ea9989b25": "jenny-socratic",
  "519674df-1ea5-47bc-99d4-8912a6975a66": "mei",
};
/** "Hear …" samples in public/tutors/voices, recorded in the voice each lesson tutor speaks with. When a voice
    changes, record the sample under a new filename so no browser plays a cached copy of the old one. */
const VOICE_SAMPLES: Record<string, string> = {
  "kenji-visual": "/tutors/voices/kenji.mp3",
  "jenny-socratic": "/tutors/voices/jenny-socratic.mp3",
  "mei-examples": "/tutors/voices/mei-examples.mp3",
};
export const voiceSampleFor = (tutorId: string): string | undefined => VOICE_SAMPLES[tutorId];

/** The portrait for a Synthesia avatar, or undefined when we have no frame for it (callers show initials). */
export const avatarPortrait = (avatarId?: string) => {
  const id = avatarId ? AVATAR_PORTRAITS[avatarId] : undefined;
  return id ? portrait(id) : undefined;
};

/* Tutors without a live avatar keep a still portrait here, keyed by tutor id (none at the moment). Give a replaced
   image a new filename: next/image caches by URL. */
const STILL_PORTRAITS: Record<string, string> = {};

/** A tutor's picture: their live avatar's frame, else their still portrait, else undefined (callers show initials). */
export const tutorPortrait = (tutor?: { tutor_id: string; avatar_id?: string }) =>
  !tutor ? undefined : avatarPortrait(tutor.avatar_id) ?? STILL_PORTRAITS[tutor.tutor_id];

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
