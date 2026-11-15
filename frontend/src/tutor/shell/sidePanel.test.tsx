import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import gd from "@/tutor/slides/decks/gradient-descent.json";
import type { Deck } from "@/tutor/slides";
import { SidePanel } from "./SidePanel";

vi.mock("./api", () => ({ getTrack: vi.fn(async () => ({ track: null, lessons: [] })), getLessonState: vi.fn(async () => null), getDeck: vi.fn(async () => ({ status: "none", source: null, deck: null, error: "", warnings: [], updated_at: null })) }));

afterEach(cleanup);

const track = {
  track_id: "t1", user_id: "demo", title: "GD", created_at: "",
  materials: [{ kind: "pdf" as const, ref: "l7.pdf", dataset_title: "Lecture 7" }],
  knowledge_points: [{ kp_id: "k1", title: "Loss landscape", summary: "", prereq_ids: [], status: "understood" as const, evidence: "" }],
};
const base = {
  trackId: "t1",
  tutorName: "Kenji",
  points: [
    { id: "a", text: "The loss is a landscape", state: "done" as const },
    { id: "b", text: "The slope points uphill", state: "now" as const },
    { id: "c", text: "Step downhill", state: "upcoming" as const },
  ],
  covered: 1,
  check: "Which way does the gradient point?",
  ideaNo: 2,
  concepts: [
    { concept: "loss as a landscape", level: "got_it" as const, evidence: "described the valley", anchor: "", tries: 1 },
    { concept: "picked an anchor only", level: null, evidence: "", anchor: "valley", tries: 0 },
  ],
  data: { track, lessons: [] },
  onTrack: vi.fn(),
  deck: gd as unknown as Deck,
  onAnswer: vi.fn(),
};

describe("side panel", () => {
  it("has Key points, Check yourself and Materials tabs — no transcript tab", () => {
    render(<SidePanel {...base} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Key points", "Check yourself", "Materials"]);
  });

  it("Key points lists the slide ideas in order and marks the current one", () => {
    render(<SidePanel {...base} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("The loss is a landscape"),
      expect.stringContaining("The slope points uphill"),
      expect.stringContaining("Step downhill"),
    ]);
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[0].getAttribute("aria-current")).toBeNull();
    screen.getByText("1 of 3 ideas covered");
  });

  it("Check yourself shows the slide's question and sends the typed answer to the tutor", () => {
    render(<SidePanel {...base} />);
    fireEvent.click(screen.getByRole("tab", { name: "Check yourself" }));
    screen.getByText("Which way does the gradient point?");
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "  uphill  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(base.onAnswer).toHaveBeenCalledWith('My answer to "Which way does the gradient point?": uphill');
    expect((screen.getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("");
    screen.getByText("Sent to Kenji.");
    // earlier checks: how they went (only concepts with a verdict)
    screen.getByText("loss as a landscape");
    screen.getByText("Got it");
    expect(screen.queryByText("picked an anchor only")).toBeNull();
  });

  it("Check yourself without a question on this slide says so", () => {
    render(<SidePanel {...base} check={null} />);
    fireEvent.click(screen.getByRole("tab", { name: "Check yourself" }));
    expect(screen.queryByLabelText("Your answer")).toBeNull();
    screen.getByText(/No question on this slide/);
  });

  it("Materials lists the sources and opens the lesson's course content for review", () => {
    render(<SidePanel {...base} />);
    fireEvent.click(screen.getByRole("tab", { name: "Materials" }));
    screen.getByText("Lecture 7");
    // add a PDF here, then prepare the track's slides from it
    screen.getByLabelText("Upload PDF");
    screen.getByRole("button", { name: /Prepare slides/ });
    fireEvent.click(screen.getByRole("button", { name: /Review course content/ }));
    const dialog = screen.getByRole("dialog", { name: "Course content" });
    expect(dialog.textContent).toContain("Loss landscape");
    screen.getByRole("region", { name: /Slide 1 of 7/ });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
