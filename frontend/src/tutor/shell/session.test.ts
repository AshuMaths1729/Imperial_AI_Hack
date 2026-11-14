import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { RoomEvent, type Room } from "livekit-client";
import {
  connectLesson,
  mergeCaption,
  onCaptions,
  sendCircle,
  sendLost,
  waitForAgent,
  type Caption,
  type RoomLike,
} from "./session";
import type { CircleEvent } from "@/tutor/contracts/types";

type Handler = (...args: unknown[]) => void;

function fakeRoom() {
  const listeners = new Map<string, Set<Handler>>();
  const rpcs = new Map<string, (d: { payload: string }) => Promise<string>>();
  const streams = new Map<string, (reader: unknown, p: { identity: string }) => void>();
  const room = {
    remoteParticipants: new Map<string, { identity: string }>(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    registerRpcMethod: vi.fn((m: string, h: (d: { payload: string }) => Promise<string>) => void rpcs.set(m, h)),
    registerTextStreamHandler: vi.fn((t: string, h: (reader: unknown, p: { identity: string }) => void) => void streams.set(t, h)),
    localParticipant: {
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
      sendText: vi.fn(async () => ({})),
    },
    on: vi.fn((e: string, fn: Handler) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(fn);
      return room;
    }),
    off: vi.fn((e: string, fn: Handler) => {
      listeners.get(e)?.delete(fn);
      return room;
    }),
    emit: (e: string, ...args: unknown[]) => listeners.get(e)?.forEach((fn) => fn(...args)),
    rpcs,
    streams,
  };
  return room;
}

afterEach(() => vi.useRealTimers());

describe("session", () => {
  it("RoomLike matches the real livekit Room", () => {
    expectTypeOf<Room>().toExtend<RoomLike>();
  });

  it("registers all board rpcs on connect", async () => {
    const room = fakeRoom();
    await connectLesson(room as unknown as RoomLike, { url: "wss://lk", token: "tok" }, () => null);

    expect([...room.rpcs.keys()].sort()).toEqual(["board.apply", "board.describe", "board.snapshot"]);
    expect(room.connect).toHaveBeenCalledWith("wss://lk", "tok");
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    // the stub board answers {ok:false}; the RPC passes the payload through and returns its reply
    const reply = JSON.parse(await room.rpcs.get("board.apply")!({ payload: '{"ops":[]}' }));
    expect(reply).toHaveProperty("ok");
  });

  it("sendCircle uses tutor.circle topic", async () => {
    const room = fakeRoom();
    const e: CircleEvent = { png_b64: "AAA", region: { x: 1, y: 2, w: 3, h: 4 }, item_ids: [], source: "screen" };
    await sendCircle(room as unknown as RoomLike, e);
    expect(room.localParticipant.sendText).toHaveBeenCalledWith(JSON.stringify(e), { topic: "tutor.circle" });
  });

  it("sendLost uses tutor.lost topic", async () => {
    const room = fakeRoom();
    await sendLost(room as unknown as RoomLike);
    expect(room.localParticipant.sendText).toHaveBeenCalledWith("{}", { topic: "tutor.lost" });
  });

  it("times out when no agent joins", async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const p = waitForAgent(room as unknown as RoomLike);
    const assertion = expect(p).rejects.toThrow("Tutor didn't join — is the agent running?");
    room.emit(RoomEvent.ParticipantConnected, { identity: "student-2" }); // another student is not the tutor
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });

  it("resolves when agent joins", async () => {
    vi.useFakeTimers();
    const room = fakeRoom();
    const p = waitForAgent(room as unknown as RoomLike);
    room.emit(RoomEvent.ParticipantConnected, { identity: "agent-AJ_123" });
    await expect(p).resolves.toBeUndefined();
    expect(room.off).toHaveBeenCalled();
  });

  it("resolves at once when the agent is already in the room", async () => {
    const room = fakeRoom();
    room.remoteParticipants.set("a", { identity: "agent-AJ_1" });
    await expect(waitForAgent(room as unknown as RoomLike)).resolves.toBeUndefined();
  });

  it("mergeCaption updates interim segment in place", () => {
    let list: Caption[] = [];
    list = mergeCaption(list, { id: "s1", who: "you", text: "what is", final: false });
    list = mergeCaption(list, { id: "s2", who: "tutor", text: "Hi", final: true });
    list = mergeCaption(list, { id: "s1", who: "you", text: "what is beta", final: true });
    expect(list).toEqual([
      { id: "s1", who: "you", text: "what is beta", final: true },
      { id: "s2", who: "tutor", text: "Hi", final: true },
    ]);
  });

  it("captions come from lk.transcription streams, attributed by sender", async () => {
    const room = fakeRoom();
    const got: Caption[] = [];
    onCaptions(room as unknown as RoomLike, (c) => got.push(c));
    const reader = (chunks: string[], attributes: Record<string, string>) => ({
      info: { id: "stream1", attributes },
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
        attributes["lk.transcription_final"] = "true"; // trailer attributes arrive at the end
      },
    });
    const handler = room.streams.get("lk.transcription")!;
    handler(reader(["So the ", "momentum"], { "lk.segment_id": "seg9", "lk.transcription_final": "false" }), {
      identity: "synthesia-avatar-agent",
    });
    await vi.waitFor(() => expect(got.at(-1)?.final).toBe(true));
    expect(got.at(-1)).toEqual({ id: "seg9", who: "tutor", text: "So the momentum", final: true });
    expect(got[0]).toEqual({ id: "seg9", who: "tutor", text: "So the ", final: false });

    handler(reader(["hello"], { "lk.segment_id": "u1" }), { identity: "student-demo" });
    await vi.waitFor(() => expect(got.at(-1)).toEqual({ id: "u1", who: "you", text: "hello", final: true }));
  });
});
