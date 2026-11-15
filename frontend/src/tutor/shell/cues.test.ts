import { describe, expect, it, vi } from "vitest";
import type { BoardHandle } from "@/tutor/contracts/types";
import type { SlidesHandle } from "@/tutor/slides";
import { makeCueScheduler, pointOnStage, type ShellStage } from "./session";

/** A tutor caption stream the way lk.transcription delivers it: one growing text per segment, word by word. */
function speak(cues: ReturnType<typeof makeCueScheduler>, id: string, text: string) {
  const words = text.split(" ");
  for (let i = 1; i <= words.length; i++) cues.onCaption({ id, who: "tutor", text: `${words.slice(0, i).join(" ")} `, final: false });
  cues.onCaption({ id, who: "tutor", text, final: true });
}

describe("speech-synced laser cues", () => {
  it("points at each tagged object when its word is spoken, counting only words after the cue script", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    speak(cues, "s0", "Earlier words never count"); // before the script
    expect(JSON.parse(cues.setCues(JSON.stringify({ cues: [{ word: 1, id: "rise" }, { word: 4, id: "run" }] })))).toEqual({ ok: true, errors: [] });

    const seen: string[] = [];
    point.mockImplementation((id: string) => seen.push(id));
    const words = "the rise over the run".split(" ");
    for (let i = 1; i <= words.length; i++) {
      cues.onCaption({ id: "s1", who: "tutor", text: words.slice(0, i).join(" "), final: false });
      if (i === 1) expect(seen).toEqual([]);
      if (i === 2) expect(seen).toEqual(["rise"]); // word 1 = "rise", just spoken
      if (i === 4) expect(seen).toEqual(["rise"]);
    }
    expect(seen).toEqual(["rise", "run"]);
    cues.onCaption({ id: "s1", who: "tutor", text: words.join(" "), final: true }); // the final repeat adds no words
    expect(seen).toEqual(["rise", "run"]);
  });

  it("the agent's contract example: 'So the rise over the run is the slope.' with cues at words 2 and 5", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    cues.setCues(JSON.stringify({ cues: [{ word: 2, id: "rise" }, { word: 5, id: "run" }] }));
    const words = "So the rise over the run is the slope.".split(" ");
    const pointedAfter: string[][] = [];
    for (let i = 1; i <= words.length; i++) {
      cues.onCaption({ id: "seg", who: "tutor", text: words.slice(0, i).join(" "), final: false });
      cues.onCaption({ id: "seg", who: "tutor", text: words.slice(0, i).join(" "), final: false }); // re-sent text
      pointedAfter.push(point.mock.calls.map((c) => c[0]));
    }
    cues.onCaption({ id: "seg", who: "tutor", text: words.join(" "), final: true });
    expect(pointedAfter[1]).toEqual([]); // "So the"
    expect(pointedAfter[2]).toEqual(["rise"]); // "rise" (word 2) spoken
    expect(pointedAfter[4]).toEqual(["rise"]); // "the"
    expect(pointedAfter[5]).toEqual(["rise", "run"]); // "run" (word 5)
    expect(point.mock.calls.map((c) => c[0])).toEqual(["rise", "run"]);
  });

  it("counts across segments and ignores interim repeats", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    cues.setCues(JSON.stringify({ cues: [{ word: 5, id: "eq" }] }));
    speak(cues, "a", "one two three");
    expect(point).not.toHaveBeenCalled();
    cues.onCaption({ id: "a", who: "tutor", text: "one two three", final: true });
    speak(cues, "b", "four five six");
    expect(point).toHaveBeenCalledExactlyOnceWith("eq");
  });

  it("a newer script replaces the pending cues and restarts the count", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    cues.setCues(JSON.stringify({ cues: [{ word: 2, id: "old" }] }));
    speak(cues, "a", "one two");
    cues.setCues(JSON.stringify({ cues: [{ word: 0, id: "new" }] }));
    speak(cues, "b", "three four five");
    expect(point.mock.calls).toEqual([["new"]]);
  });

  it("a burst of words fires only the latest due cue", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    cues.setCues(JSON.stringify({ cues: [{ word: 0, id: "a" }, { word: 1, id: "b" }, { word: 9, id: "c" }] }));
    cues.onCaption({ id: "s", who: "tutor", text: "first second third", final: false });
    expect(point.mock.calls).toEqual([["b"]]);
  });

  it("the student speaking drops what is left of the script (the tutor was interrupted)", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    cues.setCues(JSON.stringify({ cues: [{ word: 3, id: "x" }] }));
    speak(cues, "a", "one two");
    cues.onCaption({ id: "u", who: "you", text: "wait", final: false });
    speak(cues, "b", "three four five");
    expect(point).not.toHaveBeenCalled();
  });

  it("replies {ok:false, errors} to bad payloads and never throws, keeping the valid cues", () => {
    const point = vi.fn();
    const cues = makeCueScheduler(point);
    for (const bad of ["not json", "[]", "{}", '{"cues":3}']) {
      const r = JSON.parse(cues.setCues(bad));
      expect(r.ok).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    const r = JSON.parse(cues.setCues(JSON.stringify({ cues: [{ word: -1, id: "a" }, { word: 0, id: "" }, { word: 0, id: "ok" }] })));
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    speak(cues, "s", "hello");
    expect(point).toHaveBeenCalledWith("ok");
  });
});

describe("pointOnStage", () => {
  const slides = (ids: string[]) =>
    ({ point: vi.fn((id: string) => (ids.includes(id) ? { ok: true, errors: [] } : { ok: false, errors: ["no"] })) }) as unknown as SlidesHandle;
  const board = (ids: string[]) =>
    ({
      applyOps: vi.fn((ops: { target_id: string }[]) =>
        ids.includes(ops[0].target_id) ? { ok: true, ids: [], errors: [] } : { ok: false, ids: [], errors: ["unknown id"] }
      ),
    }) as unknown as BoardHandle;
  const stage = (tab: "board" | "slides" | "screen", s: SlidesHandle) =>
    ({ tab: () => tab, showTab: vi.fn(), slides: s, clearCircle: vi.fn() }) as ShellStage;

  it("points on the active stage: slides.point on the slides, a board point_at on the whiteboard", () => {
    const s = slides(["rise"]), b = board(["eq1"]);
    const st = stage("slides", s);
    pointOnStage(st, b, "rise");
    expect(s.point).toHaveBeenCalledWith("rise");
    expect(b.applyOps).not.toHaveBeenCalled();
    expect(st.showTab).not.toHaveBeenCalled();

    const sb = stage("board", s);
    pointOnStage(sb, b, "eq1");
    expect(b.applyOps).toHaveBeenCalledWith([{ op: "point_at", target_id: "eq1" }]);
    expect(sb.showTab).not.toHaveBeenCalled();
  });

  it("an object that is only on the slides brings the slides back (F3: the tutor talks about the slide again)", () => {
    const s = slides(["rise"]), b = board(["eq1"]);
    const st = stage("board", s);
    pointOnStage(st, b, "rise");
    expect(s.point).toHaveBeenCalledWith("rise");
    expect(st.showTab).toHaveBeenCalledWith("slides");
  });

  it("an id on neither stage changes nothing", () => {
    const s = slides([]), b = board([]);
    const st = stage("slides", s);
    pointOnStage(st, b, "ghost");
    expect(st.showTab).not.toHaveBeenCalled();
    pointOnStage(null, null, "ghost"); // stage not ready yet
  });
});

