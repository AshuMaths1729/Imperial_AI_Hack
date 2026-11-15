import { describe, expect, it } from "vitest";
import type { KP, Lesson } from "./api";
import { kpMarks, lastLesson, timeAgo } from "./progress";

const kp = (kp_id: string, status: KP["status"], prereq_ids: string[] = []) => ({ kp_id, status, prereq_ids });
const lesson = (lesson_id: string, started_at: string): Lesson => ({
  lesson_id, track_id: "t", tutor_id: "x", started_at, ended_at: null, summary: "",
  covered_kp_ids: [], struggles: [], worked: [], board_snapshot_ref: null,
});

describe("kpMarks", () => {
  it("understood stays, introduced is to revisit, the first ready point is next up, the rest later", () => {
    const m = kpMarks([kp("a", "understood"), kp("b", "introduced", ["a"]), kp("c", "not_started", ["b"]), kp("d", "not_started", ["a"])]);
    expect([...m.values()]).toEqual(["understood", "revisit", "later", "next"]);
  });

  it("falls back to the first not-started point when none has its prerequisites understood", () => {
    const m = kpMarks([kp("a", "not_started", ["z"]), kp("z", "not_started", ["a"])]);
    expect(m.get("a")).toBe("next");
    expect(m.get("z")).toBe("later");
  });

  it("a point the last lesson struggled with is to revisit, even if not started", () => {
    const m = kpMarks([kp("a", "not_started"), kp("b", "not_started")], ["a"]);
    expect(m.get("a")).toBe("revisit");
    expect(m.get("b")).toBe("next");
  });
});

describe("lastLesson", () => {
  it("is the most recently started lesson, whatever the order", () => {
    expect(lastLesson([lesson("1", "2026-11-15T04:13:07Z"), lesson("3", "2026-11-15T04:55:25Z"), lesson("2", "2026-11-15T04:53:48Z")])?.lesson_id).toBe("3");
    expect(lastLesson([])).toBeUndefined();
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  it.each([
    ["2026-11-15T11:59:40Z", "just now"],
    ["2026-11-15T11:55:00Z", "5 min ago"],
    ["2026-11-15T10:00:00Z", "2h ago"],
    ["2026-11-14T10:00:00Z", "yesterday"],
    ["2026-11-12T12:00:00Z", "3 days ago"],
    ["not a date", ""],
  ])("%s → %s", (iso, text) => expect(timeAgo(iso, now)).toBe(text));
});
