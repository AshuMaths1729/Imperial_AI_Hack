"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteVideoTrack,
} from "livekit-client";
import { startTutorSession } from "./api";

export type CallStatus = "idle" | "connecting" | "live" | "error";
export type Caption = { id: string; who: "tutor" | "you"; text: string; tutorId?: string };

/** One live lesson: LiveKit room with the avatar agent; the agent reports its active tutor as the `tutor_id` attribute. */
export function useAvatarCall() {
  const roomRef = useRef<Room | null>(null);
  const activeRef = useRef<string | undefined>(undefined); // tutor speaking now, stamped on captions
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string>();
  const [avatarVideo, setAvatarVideo] = useState<RemoteVideoTrack>();
  const [activeTutorId, setActiveTutorId] = useState<string>();
  const [switchingTo, setSwitchingTo] = useState<string>();
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [tutorSpeaking, setTutorSpeaking] = useState(false);
  const [mic, setMic] = useState(false);

  const reset = () => {
    setAvatarVideo(undefined);
    setActiveTutorId(undefined);
    setSwitchingTo(undefined);
    setTutorSpeaking(false);
    setMic(false);
  };

  const end = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    void room?.disconnect();
    reset();
    setStatus("idle");
  }, []);

  const start = useCallback(async (tutorId: string) => {
    if (roomRef.current) return;
    const room = new Room({ adaptiveStream: false }); // keep the avatar sharp
    roomRef.current = room;
    setStatus("connecting");
    setError(undefined);
    setCaptions([]);

    const onTutorAttr = (p: Participant) => {
      const id = p.attributes["tutor_id"];
      if (id && !p.isLocal) {
        activeRef.current = id;
        setActiveTutorId(id);
        setSwitchingTo((s) => (s === id ? undefined : s));
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.hidden = true;
          document.body.appendChild(el);
        } else if (track.kind === Track.Kind.Video) {
          setAvatarVideo(track as RemoteVideoTrack); // only the avatar publishes video
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) setAvatarVideo(undefined);
      })
      .on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, p: Participant) => onTutorAttr(p))
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => onTutorAttr(p))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => setTutorSpeaking(speakers.some((s) => !s.isLocal)))
      .on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return; // we left on purpose
        roomRef.current = null;
        reset();
        setError("The lesson connection closed.");
        setStatus("error");
      });

    // LiveKit Agents captions: the tutor's words stream in as they're spoken; the sender identity tells who spoke.
    room.registerTextStreamHandler("lk.transcription", async (reader, p) => {
      const id = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
      const who = p.identity === room.localParticipant.identity ? "you" : "tutor";
      let text = "";
      for await (const chunk of reader) {
        text += chunk;
        const c: Caption = { id, who, text, tutorId: activeRef.current };
        setCaptions((l) => {
          const i = l.findIndex((x) => x.id === id);
          return i === -1 ? [...l, c].slice(-30) : l.map((x, j) => (j === i ? c : x));
        });
      }
    });

    try {
      const s = await startTutorSession(tutorId);
      await room.connect(s.url, s.token);
      if (roomRef.current !== room) return;
      await room.localParticipant.setMicrophoneEnabled(true).then(
        () => setMic(true),
        () => setMic(false) // mic blocked: the text box still works
      );
      await room.startAudio().catch(() => {}); // Safari: unlock audio inside the Join click
      room.remoteParticipants.forEach(onTutorAttr);
      setStatus("live");
    } catch (e) {
      if (roomRef.current !== room) return;
      roomRef.current = null;
      void room.disconnect();
      reset();
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  // leave on tab close and on unmount
  useEffect(() => {
    const onUnload = () => roomRef.current?.disconnect();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      const room = roomRef.current;
      roomRef.current = null;
      void room?.disconnect();
    };
  }, []);

  return {
    status,
    error,
    avatarVideo,
    activeTutorId,
    switchingTo,
    captions,
    tutorSpeaking,
    mic,
    start,
    end,
    switchTutor: useCallback((tutorId: string) => {
      if (!roomRef.current) return;
      setSwitchingTo(tutorId);
      void roomRef.current.localParticipant.sendText(tutorId, { topic: "tutor.switch" });
    }, []),
    // LiveKit Agents reads typed user input from the `lk.chat` topic
    sendText: useCallback((text: string) => {
      const room = roomRef.current;
      if (!room) return;
      void room.localParticipant.sendText(text, { topic: "lk.chat" });
      setCaptions((l) => [...l, { id: `chat-${Date.now()}`, who: "you" as const, text }].slice(-30));
    }, []),
    toggleMic: useCallback(async () => {
      const next = !mic;
      const ok = await roomRef.current?.localParticipant.setMicrophoneEnabled(next).then(
        () => true,
        () => false
      );
      if (ok) setMic(next);
    }, [mic]),
  };
}
