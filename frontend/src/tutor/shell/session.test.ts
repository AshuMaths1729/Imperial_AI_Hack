import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { RoomEvent, type Room } from "livekit-client";
import {
  connectLesson,
  joinLesson,
  mergeCaption,
  onCaptions,
  sendCircle,
  sendLost,
  waitForAgent,
  type Caption,
  type RoomLike,
} from "./session";
import type { BoardHandle, CircleEvent } from "@/tutor/contracts/types";

type Handler = (...args: unknown[]) => void;

function fakeRoom() {
  const listeners = new Map<string, Set<Handler>>();
  const rpcs = new Map<string, (d: { payload: string }) => Promise<string>>();
  const streams = new Map<string, (reader: unknown, p: { identity: string }) => void>();
  const room = {
    remoteParticipants: new Map<string, { identity: string }>(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
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

  it("registers all board, stage and slides rpcs on connect", async () => {
    const room = fakeRoom();
    const showTab = vi.fn();
    await connectLesson(room as unknown as RoomLike, { url: "wss://lk", token: "tok" }, () => null, undefined, () => ({ showTab, slides: null }));

    expect([...room.rpcs.keys()].sort()).toEqual([
      "board.apply", "board.describe", "board.snapshot",
      "slides.describe", "slides.go", "slides.point", "slides.push", "slides.step", "ui.show_tab",
    ]);
    expect(JSON.parse(await room.rpcs.get("ui.show_tab")!({ payload: '{"tab":"slides"}' })).ok).toBe(true);
    expect(showTab).toHaveBeenCalledWith("slides");
    expect(room.connect).toHaveBeenCalledWith("wss://lk", "tok");
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    // the stub board answers {ok:false}; the RPC passes the payload through and returns its reply
    const reply = JSON.parse(await room.rpcs.get("board.apply")!({ payload: '{"ops":[]}' }));
    expect(reply).toHaveProperty("ok");
  });

  it("the stage switches to the whiteboard when the tutor writes on it", async () => {
    const room = fakeRoom();
    const showTab = vi.fn();
    const board = { applyOps: vi.fn(() => ({ ok: true, ids: ["eq1"], errors: [] })) } as unknown as BoardHandle;
    await connectLesson(room as unknown as RoomLike, { url: "wss://lk", token: "tok" }, () => board, undefined, () => ({ showTab, slides: null }));

    await room.rpcs.get("board.apply")!({ payload: '{"ops":[{"op":"point_at","target_id":"eq1"}]}' });
    expect(showTab).toHaveBeenCalledWith("board"); // anything the tutor does on the board must be visible
    showTab.mockClear();
    await room.rpcs.get("board.describe")!({ payload: "{}" }).catch(() => undefined);
    expect(showTab).not.toHaveBeenCalled(); // reading the board doesn't take the stage
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

  describe("joinLesson (Leave while connecting)", () => {
    const info = { url: "wss://lk", token: "tok", room: "r", lesson_id: "L1" };
    const deferred = <T,>() => {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };
    const micTurnedOn = (room: ReturnType<typeof fakeRoom>) =>
      room.localParticipant.setMicrophoneEnabled.mock.calls.some((c) => (c as unknown[])[0] === true);

    it("joins: connects, opens the mic and resolves true when the agent is there", async () => {
      const room = fakeRoom();
      room.remoteParticipants.set("a", { identity: "agent-1" });
      const onLesson = vi.fn();
      await expect(joinLesson(room as unknown as RoomLike, async () => info, () => null, new AbortController().signal, onLesson)).resolves.toBe(true);
      expect(onLesson).toHaveBeenCalledWith("L1");
      expect(micTurnedOn(room)).toBe(true);
      expect(room.disconnect).not.toHaveBeenCalled();
    });

    it("leave during startSession never connects and leaves no mic on", async () => {
      const room = fakeRoom();
      const session = deferred<typeof info>();
      const ac = new AbortController();
      const p = joinLesson(room as unknown as RoomLike, () => session.promise, () => null, ac.signal);
      ac.abort();
      session.resolve(info);
      await expect(p).resolves.toBe(false);
      expect(room.connect).not.toHaveBeenCalled();
      expect(micTurnedOn(room)).toBe(false);
      expect(room.disconnect).toHaveBeenCalled();
    });

    it("leave during connect disconnects once connected, without opening the mic", async () => {
      const room = fakeRoom();
      const connected = deferred<void>();
      room.connect.mockImplementation(() => connected.promise);
      const ac = new AbortController();
      const p = joinLesson(room as unknown as RoomLike, async () => info, () => null, ac.signal);
      await vi.waitFor(() => expect(room.connect).toHaveBeenCalled());
      ac.abort();
      connected.resolve();
      await expect(p).resolves.toBe(false);
      expect(micTurnedOn(room)).toBe(false);
      expect(room.disconnect).toHaveBeenCalled();
    });

    it("leave while waiting for the agent clears the timer and listener and disconnects", async () => {
      vi.useFakeTimers();
      const room = fakeRoom();
      const ac = new AbortController();
      const p = joinLesson(room as unknown as RoomLike, async () => info, () => null, ac.signal);
      await vi.waitFor(() => expect(room.on).toHaveBeenCalledWith(RoomEvent.ParticipantConnected, expect.any(Function)));
      ac.abort();
      await expect(p).resolves.toBe(false);
      expect(room.off).toHaveBeenCalledWith(RoomEvent.ParticipantConnected, expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      expect(room.disconnect).toHaveBeenCalled();
    });

    it("a real failure disconnects and rethrows", async () => {
      const room = fakeRoom();
      await expect(
        joinLesson(room as unknown as RoomLike, async () => { throw new Error("LiveKit is not configured"); }, () => null, new AbortController().signal)
      ).rejects.toThrow("LiveKit is not configured");
      expect(room.disconnect).toHaveBeenCalled();
    });
  });
});
