// Framework-free lesson plumbing over a LiveKit room (README §8). Tested with a fake room.
import { RoomEvent, type RpcInvocationData, type TextStreamReader } from "livekit-client";
import { makeBoardRpcHandlers } from "@/tutor/board";
import type { BoardHandle, BoardRpcMethod, CircleEvent } from "@/tutor/contracts/types";

/** The subset of livekit-client 2.24 `Room` this app uses (checked against the real type in session.test.ts). */
export type RoomLike = {
  remoteParticipants: Map<string, { identity: string }>;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  registerRpcMethod(method: string, handler: (data: RpcInvocationData) => Promise<string>): void;
  registerTextStreamHandler(topic: string, handler: (reader: TextStreamReader, p: { identity: string }) => void): void;
  localParticipant: {
    setMicrophoneEnabled(on: boolean): Promise<unknown>;
    setCameraEnabled(on: boolean): Promise<unknown>;
    setScreenShareEnabled(on: boolean): Promise<unknown>;
    sendText(text: string, options?: { topic?: string }): Promise<unknown>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: RoomEvent, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: RoomEvent, listener: (...args: any[]) => void): unknown;
};

export type Caption = { id: string; who: "tutor" | "you"; text: string; final: boolean };

export const AVATAR_IDENTITY = "synthesia-avatar-agent";
export const AGENT_TIMEOUT_MESSAGE = "Tutor didn't join — is the agent running?";
const isStudent = (identity: string) => identity.startsWith("student-");

/** Registers the board RPCs (before connecting, so the agent never calls an unregistered method), connects, enables the mic. */
export async function connectLesson(
  room: RoomLike,
  s: { url: string; token: string },
  getBoard: () => BoardHandle | null
): Promise<void> {
  const handlers = makeBoardRpcHandlers(getBoard);
  for (const method of Object.keys(handlers) as BoardRpcMethod[]) {
    room.registerRpcMethod(method, (d) => handlers[method](d.payload));
  }
  await room.connect(s.url, s.token);
  await room.localParticipant.setMicrophoneEnabled(true);
}

export const sendCircle = async (room: RoomLike, e: CircleEvent) => {
  await room.localParticipant.sendText(JSON.stringify(e), { topic: "tutor.circle" });
};

export const sendLost = async (room: RoomLike) => {
  await room.localParticipant.sendText("{}", { topic: "tutor.lost" });
};

/** Resolves when any non-student participant (agent or avatar) is in the room; rejects after `timeoutMs`. */
export function waitForAgent(room: RoomLike, timeoutMs = 20000): Promise<void> {
  if ([...room.remoteParticipants.values()].some((p) => !isStudent(p.identity))) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onJoin = (p: { identity: string }) => {
      if (isStudent(p.identity)) return;
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      resolve();
    };
    const timer = setTimeout(() => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      reject(new Error(AGENT_TIMEOUT_MESSAGE));
    }, timeoutMs);
    room.on(RoomEvent.ParticipantConnected, onJoin);
  });
}

/** Replaces the segment with the same id (interim → final) instead of appending a duplicate. */
export function mergeCaption(list: Caption[], seg: Caption): Caption[] {
  const i = list.findIndex((c) => c.id === seg.id);
  if (i === -1) return [...list, seg];
  const next = list.slice();
  next[i] = seg;
  return next;
}

/**
 * Captions from LiveKit Agents' `lk.transcription` text streams. The agent sends each caption with
 * `sender_identity` = the speaker, so a student identity means "you". The tutor's speech streams
 * word by word and gets `lk.transcription_final: "true"` in the closing trailer; student interim
 * transcripts are separate streams marked "false" that share the segment id with the final one.
 */
export function onCaptions(room: RoomLike, cb: (c: Caption) => void) {
  room.registerTextStreamHandler("lk.transcription", async (reader, p) => {
    const attrs = () => reader.info.attributes ?? {};
    const id = attrs()["lk.segment_id"] ?? reader.info.id;
    const who = isStudent(p.identity) ? "you" : "tutor";
    let text = "";
    for await (const chunk of reader) {
      text += chunk;
      cb({ id, who, text, final: false });
    }
    cb({ id, who, text, final: attrs()["lk.transcription_final"] !== "false" });
  });
}
