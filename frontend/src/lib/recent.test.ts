import { describe, expect, it } from "vitest";
import type { LibraryTopic } from "../components/LibraryView";
import type { Track } from "../tutor/shell/api";
import {
  dedupeTopics,
  evidenceItems,
  findArxivId,
  lessonHref,
  lessonItems,
  mergeRecent,
  paperItems,
  paperKey,
  paperSource,
  relativeTime,
  type RecentItem,
} from "./recent";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600e3;
const D = 24 * H;

const topic = (over: Partial<LibraryTopic>): LibraryTopic => ({
  id: "t",
  title: "A paper",
  subtitle: "",
  mode: "paper2sim",
  sourceLabel: "paper.pdf",
  sourceType: "pdf",
  updatedAt: ago(H),
  lastReply: "",
  ...over,
});
const simDataset = (arxiv: string, simTitle: string, nParams: number) =>
  ({
    mode: "paper2sim",
    title: "x",
    subtitle: "",
    nodes: [],
    edges: [],
    simulation: {
      paper_title: "x",
      arxiv_id: arxiv,
      equation_latex: "",
      summary: "",
      python_code: "",
      sim_title: simTitle,
      params: Array.from({ length: nParams }, (_, i) => ({
        key: `p${i}`,
        name: `p${i}`,
        min_val: 0,
        max_val: 1,
        step: 0.1,
        default_val: 0.5,
        unit: "",
      })),
      x_label: "",
      y_label: "",
      x: [],
      series: [],
    },
  }) as unknown as LibraryTopic["dataset"];

describe("relativeTime", () => {
  it("reads like a person would say it", () => {
    expect(relativeTime(ago(10e3), NOW)).toBe("Just now");
    expect(relativeTime(ago(5 * 60e3), NOW)).toBe("5 min ago");
    expect(relativeTime(ago(H - 60e3), NOW)).toBe("59 min ago");
    expect(relativeTime(ago(2 * H - 30e3), NOW)).toBe("2h ago");
    expect(relativeTime(ago(30 * H), NOW)).toBe("Yesterday");
    expect(relativeTime(ago(4 * D), NOW)).toBe("4 days ago");
    expect(relativeTime("2026-11-01T09:00:00Z", NOW)).toBe("Nov 1");
    expect(relativeTime("2025-03-02T09:00:00Z", NOW)).toBe("Mar 2, 2025");
  });

  it("is empty for missing or broken dates, and never negative", () => {
    expect(relativeTime(null, NOW)).toBe("");
    expect(relativeTime("not a date", NOW)).toBe("");
    expect(relativeTime(new Date(NOW + 5 * 60e3).toISOString(), NOW)).toBe("Just now");
  });
});

describe("arXiv ids and paper identity", () => {
  it("finds new- and old-style ids, without version", () => {
    expect(findArxivId("https://arxiv.org/abs/1706.03762v5")).toBe("1706.03762");
    expect(findArxivId("2401.12345")).toBe("2401.12345");
    expect(findArxivId("hep-th/9901001v2")).toBe("hep-th/9901001");
    expect(findArxivId("https://arxiv.org/abs/hep-th/9901001")).toBe("hep-th/9901001");
    expect(findArxivId("https://example.com/abs/1234567")).toBeNull();
    expect(findArxivId("sim_heavy_ball")).toBeNull();
    expect(findArxivId(undefined)).toBeNull();
  });

  it("keys a paper by arXiv id when it has one, else by where it came from", () => {
    const a = topic({ id: "1", sourceType: "url", sourceLabel: "https://arxiv.org/abs/1706.03762" });
    const b = topic({ id: "2", sourceType: "url", sourceLabel: "1706.03762v2" });
    const c = topic({ id: "3", sourceType: "pdf", sourceLabel: "x.pdf", dataset: simDataset("1706.03762", "m", 1) });
    expect(paperKey(a)).toBe("arxiv:1706.03762");
    expect(paperKey(b)).toBe(paperKey(a));
    expect(paperKey(c)).toBe(paperKey(a));
    // a sim id in arxiv_id is not an arXiv id
    expect(paperKey(topic({ sourceLabel: "Notes.PDF", dataset: simDataset("sim_abc", "m", 1) }))).toBe("pdf:notes.pdf");
    expect(paperKey(topic({ id: "seed", sourceType: "preset", sourceLabel: "Example" }))).toBe("preset:seed");
  });

  it("keeps the first (newest) entry of each paper and leaves different papers alone", () => {
    const list = [
      topic({ id: "new", sourceType: "url", sourceLabel: "https://arxiv.org/abs/1706.03762" }),
      topic({ id: "other", sourceLabel: "other.pdf" }),
      topic({ id: "old", sourceType: "url", sourceLabel: "1706.03762" }),
      topic({ id: "again", sourceLabel: "OTHER.pdf " }),
      topic({ id: "seed-a", sourceType: "preset", sourceLabel: "Example" }),
      topic({ id: "seed-b", sourceType: "preset", sourceLabel: "Example" }),
    ];
    expect(dedupeTopics(list).map((t) => t.id)).toEqual(["new", "other", "seed-a", "seed-b"]);
  });

  it("names the source briefly", () => {
    expect(paperSource(topic({ sourceType: "url", sourceLabel: "https://arxiv.org/abs/1706.03762" }))).toBe("arXiv 1706.03762");
    expect(paperSource(topic({ sourceLabel: "memory.pdf" }))).toBe("memory.pdf");
    expect(paperSource(topic({ sourceType: "preset", sourceLabel: "Paper2Sim Preset" }))).toBe("Example");
  });
});

describe("recent items", () => {
  it("lists opened papers (not built-in examples) once each, with their sliders", () => {
    const items = paperItems([
      topic({ id: "a", title: "Attention", sourceType: "url", sourceLabel: "1706.03762", dataset: simDataset("1706.03762", "Scaled attention", 3) }),
      topic({ id: "a-old", title: "Attention", sourceType: "url", sourceLabel: "https://arxiv.org/abs/1706.03762" }),
      topic({ id: "seed", sourceType: "preset", sourceLabel: "Paper2Sim Preset" }),
      topic({ id: "lec", mode: "lecture" }),
      topic({ id: "b", title: "Memory", sourceLabel: "memory.pdf", dataset: simDataset("sim_x", "Memory", 1) }),
    ]);
    expect(items.map((i) => [i.id, i.detail, i.chip])).toEqual([
      ["a", "Scaled attention", "3 sliders"],
      ["b", "memory.pdf", "1 slider"],
    ]);
    expect(items[0]).toMatchObject({ key: "paper2sim:a", module: "paper2sim" });
  });

  it("parses Evidence Map history defensively and never throws", () => {
    expect(evidenceItems(null)).toEqual([]);
    expect(evidenceItems("{not json")).toEqual([]);
    expect(evidenceItems(JSON.stringify({ id: "x" }))).toEqual([]);
    const raw = JSON.stringify([
      null,
      "text",
      { id: "no-dataset", title: "T" },
      { id: 4, title: "bad id", dataset: {} },
      {
        id: "hyp-1",
        title: "  Chinchilla vs Kaplan ",
        updatedAt: ago(2 * D),
        dataset: {
          nodes: [{ category: "paper" }, { category: "paper" }, { category: "gap" }, null],
          edges: [{ type: "contradicts" }, { type: "supports" }, "junk"],
        },
      },
      { id: "hyp-2", dataset: { nodes: "nope" } },
    ]);
    expect(evidenceItems(raw)).toEqual([
      {
        key: "hypothesis:hyp-1",
        module: "hypothesis",
        id: "hyp-1",
        title: "Chinchilla vs Kaplan",
        detail: "2 papers",
        chip: "1 conflict",
        at: ago(2 * D),
      },
      { key: "hypothesis:hyp-2", module: "hypothesis", id: "hyp-2", title: "Untitled question", detail: "", chip: undefined, at: null },
    ]);
  });

  it("describes lesson tracks by progress and links to them", () => {
    const track = (over: Partial<Track>): Track => ({
      track_id: "differentiation",
      user_id: "demo",
      title: "Differentiation",
      materials: [],
      knowledge_points: [],
      created_at: ago(3 * H),
      ...over,
    });
    const kp = (status: "not_started" | "introduced" | "understood") => ({
      kp_id: status,
      title: "",
      summary: "",
      prereq_ids: [],
      status,
      evidence: "",
    });
    const items = lessonItems([
      track({ knowledge_points: [kp("understood"), kp("understood"), kp("not_started")] }),
      track({ track_id: "new", title: "", materials: [{ kind: "pdf", ref: "a.pdf", dataset_title: "A" }] }),
    ]);
    expect(items.map((i) => [i.title, i.detail, i.chip])).toEqual([
      ["Differentiation", "2 of 3 ideas understood", "Resume"],
      ["Untitled lesson", "1 source", "Start"],
    ]);
    expect(lessonHref("gradient descent")).toBe("/lecture/lesson?track=gradient%20descent");
  });

  it("merges newest first, undated items last in their original order", () => {
    const item = (key: string, at: string | null): RecentItem => ({ key, module: "lecture", id: key, title: key, detail: "", at });
    const merged = mergeRecent(
      [item("p-old", ago(3 * D)), item("p-undated", null)],
      [item("e-new", ago(H)), item("e-bad", "garbage")],
      [item("l-mid", ago(D))]
    );
    expect(merged.map((i) => i.key)).toEqual(["e-new", "l-mid", "p-old", "p-undated", "e-bad"]);
  });
});
