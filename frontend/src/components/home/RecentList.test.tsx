import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LibraryTopic } from "../LibraryView";
import { listTracks } from "../../tutor/shell/api";
import { RecentList } from "./RecentList";

vi.mock("../../tutor/shell/api", () => ({ listTracks: vi.fn() }));
const mockedTracks = vi.mocked(listTracks);

const HIST = "scholartwin.hypothesis.history.v1";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const H = 3600e3;

const paper = (id: string, title: string, at: string, over: Partial<LibraryTopic> = {}): LibraryTopic => ({
  id,
  title,
  subtitle: "",
  mode: "paper2sim",
  sourceLabel: `${id}.pdf`,
  sourceType: "pdf",
  updatedAt: at,
  lastReply: "",
  ...over,
});
const track = {
  track_id: "differentiation",
  user_id: "demo",
  title: "Differentiation",
  materials: [],
  knowledge_points: [
    { kp_id: "a", title: "", summary: "", prereq_ids: [], status: "understood" as const, evidence: "" },
    { kp_id: "b", title: "", summary: "", prereq_ids: [], status: "not_started" as const, evidence: "" },
  ],
  created_at: iso(3 * H),
};

function setup(papers: LibraryTopic[] = []) {
  const handlers = { onOpenPaper: vi.fn(), onDeletePaper: vi.fn(), onOpenEvidence: vi.fn() };
  render(<RecentList papers={papers} {...handlers} />);
  return handlers;
}

beforeEach(() => {
  localStorage.clear();
  mockedTracks.mockReset();
});
afterEach(cleanup);

describe("Pick up where you left off", () => {
  it("lists papers, evidence topics and lessons together, newest first", async () => {
    mockedTracks.mockResolvedValue([track]);
    localStorage.setItem(
      HIST,
      JSON.stringify([{ id: "hyp-1", title: "Chinchilla vs Kaplan", updatedAt: iso(5 * H), dataset: { nodes: [], edges: [] } }])
    );
    setup([paper("p1", "Attention Is All You Need", iso(H)), paper("seed", "Example", iso(0), { sourceType: "preset" })]);

    await screen.findByText("Differentiation");
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => within(r).getAllByText(/./)[0].textContent)).toEqual([
      "Attention Is All You Need",
      "Differentiation",
      "Chinchilla vs Kaplan",
    ]);
    expect(rows[0].textContent).toContain("Paper Simulator · p1.pdf");
    expect(rows[1].textContent).toContain("Live Lessons · 1 of 2 ideas understood");
    expect(rows[2].textContent).toContain("Evidence Map");
    // built-in examples are not "where you left off"
    expect(screen.queryByText("Example")).toBeNull();
  });

  it("opens each kind of item the way its module does", async () => {
    mockedTracks.mockResolvedValue([track]);
    localStorage.setItem(HIST, JSON.stringify([{ id: "hyp-1", title: "Chinchilla", updatedAt: iso(H), dataset: {} }]));
    const p = paper("p1", "Attention", iso(2 * H));
    const h = setup([p]);

    const lesson = await screen.findByRole("link", { name: /Differentiation/ });
    expect(lesson.getAttribute("href")).toBe("/lecture/lesson?track=differentiation");

    fireEvent.click(screen.getByRole("button", { name: /Chinchilla/ }));
    expect(h.onOpenEvidence).toHaveBeenCalledWith("hyp-1");

    fireEvent.click(screen.getByRole("button", { name: /^Attention/ }));
    expect(h.onOpenPaper).toHaveBeenCalledWith(p);

    fireEvent.click(screen.getByRole("button", { name: "Remove Attention" }));
    // asks once before deleting
    fireEvent.click(screen.getByRole("button", { name: "Confirm: Remove Attention" }));
    expect(h.onDeletePaper).toHaveBeenCalledWith("p1");
    // only papers can be removed from here
    expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(1);
  });

  it("leaves lessons out when the backend is unreachable", async () => {
    mockedTracks.mockRejectedValue(new Error("offline"));
    setup([paper("p1", "Attention", iso(H))]);
    expect(await screen.findByText("Attention")).toBeTruthy();
    expect(screen.queryByText("Differentiation")).toBeNull();
  });

  it("shows a designed empty state when nothing is saved yet", async () => {
    mockedTracks.mockResolvedValue([]);
    setup([paper("seed", "Heavy-Ball", iso(H), { sourceType: "preset" })]);
    expect(await screen.findByText("Nothing to pick up yet")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("ignores a malformed Evidence Map history", async () => {
    mockedTracks.mockResolvedValue([]);
    localStorage.setItem(HIST, "{oops");
    setup();
    expect(await screen.findByText("Nothing to pick up yet")).toBeTruthy();
    expect(localStorage.getItem(HIST)).toBe("{oops"); // read-only: never rewritten
  });

  it("shows the first six and expands to all", async () => {
    mockedTracks.mockResolvedValue([]);
    setup(Array.from({ length: 8 }, (_, i) => paper(`p${i}`, `Paper ${i}`, iso((i + 1) * H))));
    await screen.findByText("Paper 0");
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show all 8" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
});
