// Framework-free lesson plumbing over a LiveKit room (README §8). Tested with a fake room.
import { RoomEvent, type RpcInvocationData, type TextStreamReader } from "livekit-client";
import { makeBoardRpcHandlers } from "@/tutor/board";
import type { BoardHandle, BoardRpcMethod, CircleEvent } from "@/tutor/contracts/types";
import { makeSlidesRpcHandlers, type SlidesRpcMethod, type StageHandle, type StageTab } from "@/tutor/slides";

/** The subset of livekit-client 2.24 `Room` this app uses (checked against the real type in session.test.ts). */
export type RoomLike = {
  remoteParticipants: Map<string, { identity: string }>;
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  startAudio(): Promise<void>;
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
/** The stage handle CallView hands in: the agent's tab/slides handle plus which tab is showing. */
export type ShellStage = StageHandle & { tab(): StageTab };
export type CueScheduler = ReturnType<typeof makeCueScheduler>;

export const AVATAR_IDENTITY = "synthesia-avatar-agent";
export const AGENT_TIMEOUT_MESSAGE = "Tutor didn't join — is the agent running?";
const isStudent = (identity: string) => identity.startsWith("student-");

/** Registers the board and stage/slides RPCs (before connecting, so the agent never calls an unregistered method), connects, enables the mic (skipped if `signal` aborted meanwhile). */
export async function connectLesson(
  room: RoomLike,
  s: { url: string; token: string },
  getBoard: () => BoardHandle | null,
  signal?: AbortSignal,
  getStage: () => StageHandle | null = () => null,
  onMicError: (e: unknown) => void = () => {},
  cues?: CueScheduler
): Promise<void> {
  const handlers = makeBoardRpcHandlers(getBoard);
  for (const method of Object.keys(handlers) as BoardRpcMethod[]) {
    room.registerRpcMethod(method, (d) => {
      // Whatever the tutor writes or points at on the board must be on screen, even mid-slides.
      if (method === "board.apply") getStage()?.showTab("board");
      return handlers[method](d.payload);
    });
  }
  const stage = makeSlidesRpcHandlers(getStage);
  for (const method of Object.keys(stage) as SlidesRpcMethod[]) {
    room.registerRpcMethod(method, (d) => stage[method](d.payload));
  }
  if (cues) room.registerRpcMethod("ui.point_cues", async (d) => cues.setCues(d.payload));
  await room.connect(s.url, s.token);
  if (signal?.aborted) return;
  // A blocked mic (site or macOS privacy settings) must not stop the lesson: the student can type, then retry the mic.
  await room.localParticipant.setMicrophoneEnabled(true).catch(onMicError);
}

/** What to tell the student when the browser refuses the microphone. */
export function micErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  const fix =
    name === "NotAllowedError"
      ? "Microphone blocked. Allow it for this site (icon left of the address bar), and for your browser in System Settings → Privacy & Security → Microphone, then click Mic."
      : name === "NotFoundError"
        ? "No microphone found. Plug one in or pick an input in System Settings → Sound, then click Mic."
        : name === "NotReadableError"
          ? "The microphone is busy in another app or blocked by macOS. Close the other app or check System Settings → Privacy & Security → Microphone, then click Mic."
          : "The microphone couldn't start.";
  return `${fix} Meanwhile you can type to the tutor.`;
}

/**
 * The whole Join sequence: session → connect → mic → wait for the tutor. `signal` is aborted by Leave/unmount;
 * then (or on any failure) the room is disconnected so the student never stays in the room with a live mic.
 * Resolves true when live, false when aborted; rethrows real failures.
 */
export async function joinLesson(
  room: RoomLike,
  fetchSession: () => Promise<{ url: string; token: string; lesson_id: string }>,
  getBoard: () => BoardHandle | null,
  signal: AbortSignal,
  onLessonId: (id: string) => void = () => {},
  getStage: () => StageHandle | null = () => null,
  onMicError: (e: unknown) => void = () => {},
  cues?: CueScheduler
): Promise<boolean> {
  try {
    const s = await fetchSession();
    if (!signal.aborted) {
      onLessonId(s.lesson_id);
      await connectLesson(room, s, getBoard, signal, getStage, onMicError, cues);
    }
    if (!signal.aborted) {
      await room.startAudio().catch(() => {}); // Safari: unlock audio close to the Join click
      await waitForAgent(room, 20000, signal);
    }
  } catch (e) {
    await room.disconnect();
    if (signal.aborted) return false;
    throw e;
  }
  if (signal.aborted) {
    await room.disconnect();
    return false;
  }
  return true;
}

export const sendCircle = async (room: RoomLike, e: CircleEvent) => {
  await room.localParticipant.sendText(JSON.stringify(e), { topic: "tutor.circle" });
};

export const sendLost = async (room: RoomLike) => {
  await room.localParticipant.sendText("{}", { topic: "tutor.lost" });
};

/** Resolves when any non-student participant (agent or avatar) is in the room; rejects after `timeoutMs` or on abort. */
export function waitForAgent(room: RoomLike, timeoutMs = 20000, signal?: AbortSignal): Promise<void> {
  if ([...room.remoteParticipants.values()].some((p) => !isStudent(p.identity))) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      signal?.removeEventListener("abort", onAbort);
    };
    const onJoin = (p: { identity: string }) => {
      if (isStudent(p.identity)) return;
      done();
      resolve();
    };
    const onAbort = () => {
      done();
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(AGENT_TIMEOUT_MESSAGE));
    }, timeoutMs);
    room.on(RoomEvent.ParticipantConnected, onJoin);
    signal?.addEventListener("abort", onAbort);
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
    try {
      for await (const chunk of reader) {
        text += chunk;
        cb({ id, who, text, final: false });
      }
    } catch {
      return; // the room closed mid-caption (leaving during speech): keep the partial text, nothing to finish
    }
    cb({ id, who, text, final: attrs()["lk.transcription_final"] !== "false" });
  });
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Speech-synced laser (F1). The agent sends `ui.point_cues {cues: [{word, id}]}` right before a speech; `word` is the
 * 0-based index of a word in that speech. Tutor captions are word-synced to the audio, so counting the tutor caption
 * words that arrive after the script tells us when each word is spoken; then `point(id)`. A newer script replaces
 * the pending cues; the student speaking (an interruption) drops them.
 */
export function makeCueScheduler(point: (id: string) => void) {
  let pending: { word: number; id: string }[] = [];
  let heard = 0;
  const seen = new Map<string, number>(); // words already counted per caption segment (captions resend the whole text)
  return {
    /** The RPC handler: replies `{ok, errors}`, never throws; malformed cues are reported and skipped. */
    setCues(payload: string): string {
      try {
        const p: unknown = JSON.parse(payload || "{}");
        const list = (p as { cues?: unknown } | null)?.cues;
        if (!Array.isArray(list)) return JSON.stringify({ ok: false, errors: ["payload must be {cues: [{word, id}]}"] });
        const errors: string[] = [];
        const valid = list.filter((c, i) => {
          const ok = Number.isInteger(c?.word) && c.word >= 0 && typeof c?.id === "string" && c.id !== "";
          if (!ok) errors.push(`cue ${i}: needs a word index >= 0 and an object id`);
          return ok;
        });
        pending = valid.map((c) => ({ word: c.word, id: c.id })).sort((a, b) => a.word - b.word);
        heard = 0;
        return JSON.stringify({ ok: !errors.length, errors });
      } catch (e) {
        return JSON.stringify({ ok: false, errors: [e instanceof Error ? e.message : String(e)] });
      }
    },
    onCaption(c: Caption) {
      if (c.who === "you") {
        pending = [];
        return;
      }
      const n = wordCount(c.text);
      const before = seen.get(c.id) ?? 0;
      if (n <= before) return;
      seen.set(c.id, n);
      heard += n - before;
      const due = pending.filter((q) => q.word < heard);
      if (!due.length) return;
      pending = pending.slice(due.length);
      point(due.at(-1)!.id); // a burst of words: only the latest pointer position matters
    },
  };
}

/**
 * Points the laser at `id` on the tab that is showing. An id that only exists on the other stage brings that stage
 * up: the tutor is talking about it again (F3: back on the slides after a whiteboard explanation).
 */
export function pointOnStage(stage: ShellStage | null, board: BoardHandle | null, id: string): void {
  if (!stage) return;
  const onSlides = () => !!stage.slides?.point(id).ok;
  const onBoard = () => !!board?.applyOps([{ op: "point_at", target_id: id }]).ok;
  const tab = stage.tab();
  if (tab === "slides" && !onSlides() && onBoard()) stage.showTab("board");
  if (tab === "board" && !onBoard() && onSlides()) stage.showTab("slides");
}
