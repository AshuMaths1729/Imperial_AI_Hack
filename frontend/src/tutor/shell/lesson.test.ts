import { describe, expect, it } from "vitest";
import { formatElapsed, keyPoints, mastery, progressOf, transcriptText } from "./lesson";
import type { Deck, SlidesDescription } from "@/tutor/slides/types";

const outline = (steps: number[], followups: number[] = []) =>
  steps.map((n, i) => ({ index: i + 1, id: `s${i + 1}`, title: `Slide ${i + 1}`, kp_ids: [], steps: n, ...(followups.includes(i + 1) ? { followup: true } : {}) }));
const at = (index: number, step: number, slides: SlidesDescription["slides"]) => ({ index, step, slides });

describe("lesson timer", () => {
  it("formats elapsed time as mm:ss, minutes growing past an hour", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(59_999)).toBe("00:59");
    expect(formatElapsed(61_000)).toBe("01:01");
    expect(formatElapsed(12 * 60_000 + 52_000)).toBe("12:52");
    expect(formatElapsed(75 * 60_000 + 5_000)).toBe("75:05");
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("lesson progress", () => {
  it("counts the ideas before the open slide, plus the open one once its last step has played", () => {
    expect(progressOf(at(1, 0, outline([3, 4, 2])))).toEqual({ now: 0, covered: 0, total: 3 });
    expect(progressOf(at(2, 1, outline([3, 4, 2])))).toEqual({ now: 1, covered: 1, total: 3 });
    expect(progressOf(at(3, 2, outline([3, 4, 2])))).toEqual({ now: 2, covered: 3, total: 3 });
  });

  it("a follow-up slide is not an idea of the lesson: it stays on the slide it explains", () => {
    const slides = outline([3, 2, 4], [2]); // slide 2 was pushed after slide 1
    expect(progressOf(at(2, 2, slides))).toEqual({ now: 0, covered: 0, total: 2 });
    expect(progressOf(at(3, 0, slides))).toEqual({ now: 1, covered: 1, total: 2 });
  });

  it("no deck: nothing to count", () => {
    expect(progressOf(null)).toEqual({ now: -1, covered: 0, total: 0 });
    expect(progressOf(at(0, 0, []))).toEqual({ now: -1, covered: 0, total: 0 });
  });

  it("key points are the slide ideas in order, done / now / upcoming", () => {
    const deck = { title: "d", slides: [{ id: "s1", title: "Slide 1", idea: "Loss is a landscape", objects: [] }, { id: "s2", title: "Slide 2", objects: [] }] } as Deck;
    const slides = outline([1, 1, 1], [2]).map((s, i) => ({ ...s, id: ["s1", "f1", "s2"][i] }));
    expect(keyPoints(deck, at(3, 0, slides))).toEqual([
      { id: "s1", text: "Loss is a landscape", state: "done" },
      { id: "s2", text: "Slide 2", state: "now" },
    ]);
  });
});

describe("mastery", () => {
  it("is the share of the track's knowledge points understood", () => {
    const kp = (status: string) => ({ status }) as never;
    expect(mastery([kp("understood"), kp("introduced"), kp("not_started")], [])).toBe(33);
    expect(mastery([kp("understood"), kp("understood")], [])).toBe(100);
  });

  it("falls back to the lesson's checked concepts when the track has no knowledge points", () => {
    expect(mastery([], [{ concept: "a", level: "got_it" }, { concept: "b", level: "shaky" }, { concept: "c", level: null }] as never)).toBe(50);
    expect(mastery([], [])).toBeNull();
  });
});

describe("transcript", () => {
  it("is plain text, one line per caption, with the speaker", () => {
    expect(
      transcriptText(
        [
          { id: "a", who: "tutor", text: "Hello there.", final: true },
          { id: "b", who: "you", text: "Hi", final: true },
          { id: "c", who: "tutor", text: "  ", final: true },
        ],
        "Kenji"
      )
    ).toBe("Kenji: Hello there.\nYou: Hi\n");
  });
});
