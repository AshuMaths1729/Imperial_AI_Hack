import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GraphNodeData, WorkspaceDataset } from "@/types/scholartwin";
import { HypothesisChatView } from "../HypothesisChatView";

// React Flow needs layout APIs jsdom lacks; the map itself isn't under test here.
vi.mock("../GraphCanvas", () => ({
  EDGE_PALETTE: {
    supports: { color: "var(--status-support)", label: "Supports" },
    contradicts: { color: "var(--status-contradict)", label: "Contradicts" },
    prerequisite: { color: "var(--status-link)", label: "Builds on" },
    gap: { color: "var(--status-gap)", label: "Open question" },
  },
  EdgeSwatch: () => null,
  GraphCanvas: ({ nodes, onSelectNode }: { nodes: GraphNodeData[]; onSelectNode: (n: GraphNodeData) => void }) => (
    <div data-testid="map">
      {nodes.map((n) => (
        <button key={n.id} type="button" onClick={() => onSelectNode(n)}>
          node:{n.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../../tutor/AskTutorButton", () => ({
  AskTutorButton: ({ topic }: { topic: { title: string } }) => <a href="#tutor">Ask a tutor about this: {topic.title}</a>,
}));
vi.mock("../ThemeProvider", () => ({ ThemeToggle: () => null }));
const createTopicGraph = vi.fn();
vi.mock("../../api/endpoints", () => ({
  createTopicGraph: (...args: unknown[]) => createTopicGraph(...args),
  stt: vi.fn(),
}));

const KEY = "scholartwin.hypothesis.history.v1";

const node = (n: Partial<GraphNodeData> & Pick<GraphNodeData, "id" | "label" | "category">): GraphNodeData => ({
  summary: "",
  mastery: 0,
  x: 0,
  y: 0,
  quiz: [],
  ...n,
});

const dataset: WorkspaceDataset = {
  mode: "hypothesis",
  title: "Chinchilla vs Kaplan",
  subtitle: "",
  nodes: [
    node({ id: "p1", label: "Training Compute-Optimal LLMs", category: "paper", authors_year: "Hoffmann et al., 2022", doc_id: "p1" }),
    node({ id: "p2", label: "Scaling Laws for Neural LMs", category: "paper", authors_year: "Kaplan et al., 2020", doc_id: "p2" }),
    node({
      id: "c_p1_0",
      label: "Scale tokens with parameters",
      category: "claim",
      doc_id: "p1",
      summary: '"model size and tokens should be scaled equally" [condition: fixed compute]',
    }),
    node({ id: "c_p2_0", label: "Grow parameters faster than data", category: "claim", doc_id: "p2" }),
  ],
  edges: [
    {
      id: "e1",
      source: "c_p1_0",
      target: "c_p2_0",
      type: "contradicts",
      evidence: [{ paper_id: "p1", quote: "tokens should be doubled" }],
    },
  ],
};

const saved = [
  { id: "hyp-1", title: "Chinchilla vs Kaplan", updatedAt: "2026-11-15T10:00:00Z", dataset },
  { id: "hyp-2", title: "Another topic", updatedAt: "2026-11-14T10:00:00Z", dataset: { ...dataset, title: "Another topic" } },
];

// A wide screen: the details sit in the side panel (below lg they dock over the map instead).
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: query === "(min-width: 1024px)",
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  localStorage.setItem(KEY, JSON.stringify(saved));
  createTopicGraph.mockReset();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = realMatchMedia;
});

describe("Evidence Map", () => {
  it("starts on the question screen with plain names", () => {
    render(<HypothesisChatView onBackHome={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Evidence Map" })).toBeTruthy();
    expect(screen.getByText(/What does the research say\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Map it/ })).toBeTruthy();
    expect(screen.queryByText(/HypothesisGraph/)).toBeNull();
    expect(screen.queryByText(/Generate graph/)).toBeNull();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("opens the saved topic named by initialTopicId on arrival", () => {
    render(<HypothesisChatView onBackHome={() => {}} initialTopicId="hyp-2" />);
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Another topic" })).toBeTruthy();
    const topics = screen.getByRole("complementary", { name: "Saved topics" });
    expect(within(topics).getByRole("button", { current: true }).textContent).toContain("Another topic");
  });

  it("stays on the question screen when initialTopicId matches no saved topic", () => {
    render(<HypothesisChatView onBackHome={() => {}} initialTopicId="gone" />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText(/What does the research say\?/)).toBeTruthy();
  });

  it("shows a paper's claims, quote and links in the side panel, and the tutor button", () => {
    render(<HypothesisChatView onBackHome={() => {}} initialTopicId="hyp-1" />);
    expect(screen.getByRole("link", { name: /Ask a tutor about this: Chinchilla vs Kaplan/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "node:Training Compute-Optimal LLMs" }));
    const details = screen.getByRole("region", { name: "Paper details" });
    expect(within(details).getByText("Scale tokens with parameters")).toBeTruthy();
    expect(within(details).getByText(/model size and tokens should be scaled equally/)).toBeTruthy();
    expect(within(details).getByText("fixed compute")).toBeTruthy();
    expect(within(details).getByRole("link", { name: /Open paper/ })).toBeTruthy();
    // "Why" opens the line's evidence, with its quote.
    fireEvent.click(within(details).getByRole("button", { name: /Why/ }));
    const line = screen.getByRole("region", { name: "Contradicts link" });
    expect(within(line).getByText(/tokens should be doubled/)).toBeTruthy();
    // Back returns to the paper; Esc clears the selection.
    fireEvent.click(within(line).getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("region", { name: "Paper details" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("region", { name: "Your question" })).toBeTruthy();
  });

  it("maps a starter question and saves it as a topic", async () => {
    createTopicGraph.mockResolvedValue({
      graph_id: "g",
      kind: "hypothesis",
      nodes: [{ id: "p9", kind: "paper", label: "A paper", summary: "", source_ref: { doc_id: "p9", page: null }, authors_year: "Doe, 2024" }],
      edges: [],
      meta: {},
    });
    localStorage.clear();
    render(<HypothesisChatView onBackHome={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Compute-optimal scaling laws/ }));
    expect(await screen.findByTestId("map")).toBeTruthy();
    expect(createTopicGraph).toHaveBeenCalledWith("Compute-optimal scaling laws: Chinchilla vs Kaplan", 12);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")[0].title).toBe("Compute-optimal scaling laws: Chinchilla vs Kaplan");
  });

  it("deletes a saved topic and returns to the question screen when it was open", () => {
    render(<HypothesisChatView onBackHome={() => {}} initialTopicId="hyp-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Chinchilla vs Kaplan" }));
    expect(screen.queryByTestId("map")).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]").map((r: { id: string }) => r.id)).toEqual(["hyp-2"]);
  });
});
