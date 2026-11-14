"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type Participant,
  type RemoteTrack,
  type RemoteParticipant,
  type RemoteVideoTrack,
} from "livekit-client";
import type { BoardHandle, CircleEvent } from "@/tutor/contracts/types";
import { startSession } from "./api";
import {
  AVATAR_IDENTITY,
  joinLesson,
  mergeCaption,
  onCaptions,
  sendCircle as sendCircleOn,
  sendLost as sendLostOn,
  type Caption,
} from "./session";

export type SessionStatus = "idle" | "connecting" | "live" | "error";

export function useTutorSession(boardRef: RefObject<BoardHandle | null>) {
  const roomRef = useRef<Room | null>(null);
  const joinAbort = useRef<AbortController | null>(null); // aborted by Leave/unmount while still joining
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string>();
  const [lessonId, setLessonId] = useState<string>();
  const [avatarVideo, setAvatarVideo] = useState<RemoteVideoTrack>();
  const [selfVideo, setSelfVideo] = useState<LocalVideoTrack>();
  const [screenTrack, setScreenTrack] = useState<LocalVideoTrack>();
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [mic, setMic] = useState(false);
  const [cam, setCam] = useState(false);
  const [tutorSpeaking, setTutorSpeaking] = useState(false);

  const reset = () => {
    setAvatarVideo(undefined);
    setSelfVideo(undefined);
    setScreenTrack(undefined);
    setMic(false);
    setCam(false);
    setTutorSpeaking(false);
  };

  const end = useCallback(() => {
    joinAbort.current?.abort();
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
    reset();
    setStatus("idle");
  }, []);

  const start = useCallback(
    async (trackId: string, tutorId: string) => {
      if (roomRef.current) return;
      const room = new Room({ adaptiveStream: false });
      const ac = new AbortController();
      roomRef.current = room;
      joinAbort.current = ac;
      setStatus("connecting");
      setError(undefined);
      setCaptions([]);

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach();
            el.hidden = true;
            document.body.appendChild(el);
          } else if (p.identity === AVATAR_IDENTITY) {
            setAvatarVideo(track as RemoteVideoTrack);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
          track.detach().forEach((el) => el.remove());
          if (track.kind === Track.Kind.Video && p.identity === AVATAR_IDENTITY) setAvatarVideo(undefined);
        })
        .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
          if (pub.source === Track.Source.Microphone) setMic(true);
          if (pub.source === Track.Source.Camera) setSelfVideo(pub.videoTrack);
          if (pub.source === Track.Source.ScreenShare) setScreenTrack(pub.videoTrack);
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
          // also fires when the browser's own "Stop sharing" button ends the capture
          if (pub.source === Track.Source.ScreenShare) setScreenTrack(undefined);
          if (pub.source === Track.Source.Camera) setSelfVideo(undefined);
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) =>
          setTutorSpeaking(speakers.some((s) => !s.isLocal))
        )
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current !== room) return; // we left on purpose
          roomRef.current = null;
          reset();
          setError("The lesson connection closed.");
          setStatus("error");
        });
      onCaptions(room, (c) => setCaptions((l) => mergeCaption(l, c)));

      try {
        // joinLesson disconnects the room itself when aborted or failing
        const live = await joinLesson(room, () => startSession(trackId, tutorId), () => boardRef.current, ac.signal, setLessonId);
        if (live) setStatus("live");
      } catch (e) {
        if (ac.signal.aborted) return;
        roomRef.current = null;
        reset();
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    },
    [boardRef]
  );

  // Leave on tab close, on unmount, and when Next hides this route (Activity runs effect cleanups).
  useEffect(() => {
    const onUnload = () => roomRef.current?.disconnect();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      joinAbort.current?.abort();
      const room = roomRef.current;
      roomRef.current = null;
      room?.disconnect();
    };
  }, []);

  const local = () => roomRef.current?.localParticipant;

  return {
    status,
    error,
    lessonId,
    avatarVideo,
    selfVideo,
    screenTrack,
    captions,
    tutorSpeaking,
    start,
    end,
    sendCircle: useCallback((e: CircleEvent) => {
      if (roomRef.current) void sendCircleOn(roomRef.current, e);
    }, []),
    sendLost: useCallback(() => {
      if (roomRef.current) void sendLostOn(roomRef.current);
    }, []),
    sendEvent: useCallback((topic: string, payload: unknown) => {
      if (roomRef.current) void roomRef.current.localParticipant.sendText(JSON.stringify(payload), { topic });
    }, []),
    // LiveKit Agents reads typed user input from the `lk.chat` topic.
    sendText: useCallback((t: string) => {
      if (!roomRef.current) return;
      void roomRef.current.localParticipant.sendText(t, { topic: "lk.chat" });
      setCaptions((l) => mergeCaption(l, { id: `chat-${Date.now()}`, who: "you", text: t, final: true }));
    }, []),
    mic,
    toggleMic: useCallback(async () => {
      const next = !mic;
      await local()?.setMicrophoneEnabled(next);
      setMic(next);
    }, [mic]),
    cam,
    toggleCam: useCallback(async () => {
      const next = !cam;
      const ok = await local()?.setCameraEnabled(next).then(() => true, () => false); // false: permission denied
      setCam(next && !!ok);
    }, [cam]),
    sharing: !!screenTrack,
    toggleShare: useCallback(async () => {
      // rejects when the user cancels the browser's share picker; nothing to do then
      await local()?.setScreenShareEnabled(!screenTrack).catch(() => undefined);
    }, [screenTrack]),
  };
}

export type TutorSession = ReturnType<typeof useTutorSession>;
