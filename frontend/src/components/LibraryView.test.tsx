import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LibraryView, type LibraryTopic } from "./LibraryView";

afterEach(cleanup);

const topic = (id: string, title: string, over: Partial<LibraryTopic> = {}): LibraryTopic => ({
  id,
  title,
  subtitle: `${title} subtitle`,
  mode: "paper2sim",
  sourceLabel: `${id}.pdf`,
  sourceType: "pdf",
  updatedAt: new Date().toISOString(),
  lastReply: "",
  ...over,
});

function setup(topics: LibraryTopic[], over: Partial<React.ComponentProps<typeof LibraryView>> = {}) {
  const props = {
    mode: "paper2sim" as const,
    topics,
    uploadLoading: false,
    uploadError: null,
    onBackHome: vi.fn(),
    onOpenTopic: vi.fn(),
    onDeleteTopic: vi.fn(),
    onUploadPdf: vi.fn(),
    onIngestUrl: vi.fn(),
    ...over,
  };
  const r = render(<LibraryView {...props} />);
  return { ...props, ...r };
}

describe("Paper Simulator start screen", () => {
  it("is titled by the module, with its description and an Open a paper panel", () => {
    setup([]);
    expect(screen.getByRole("heading", { level: 1, name: "Paper Simulator" })).toBeTruthy(); // header
    expect(screen.getByRole("heading", { level: 2, name: "Paper Simulator" })).toBeTruthy(); // page title
    expect(screen.getByText(/Drop in a paper and get its equations as a live chart/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Open a paper" })).toBeTruthy();
    expect(screen.queryByText(/New Conversation/i)).toBeNull();
    expect(screen.getByText("No papers yet")).toBeTruthy();
  });

  it("lists each paper once, without a module badge, and opens or removes it", () => {
    const a = topic("a", "Attention", { sourceType: "url", sourceLabel: "https://arxiv.org/abs/1706.03762" });
    const dup = topic("a-old", "Attention", { sourceType: "url", sourceLabel: "1706.03762v2" });
    const b = topic("b", "Memory");
    const { container, onOpenTopic, onDeleteTopic } = setup([a, dup, b]);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 papers")).toBeTruthy();
    expect(container.textContent).not.toContain("PaperSim");
    // the second line says what it simulates and where it came from
    expect(screen.getByText("Attention subtitle · arXiv 1706.03762")).toBeTruthy();
    expect(screen.getByText("Memory subtitle · b.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Memory/ }));
    expect(onOpenTopic).toHaveBeenCalledWith(b);
    fireEvent.click(screen.getByRole("button", { name: "Remove Attention" }));
    expect(onDeleteTopic).toHaveBeenCalledWith("a");
  });

  it("loads an arXiv link and goes back home", () => {
    const { onIngestUrl, onBackHome } = setup([]);
    const input = screen.getByRole("textbox", { name: "arXiv URL or ID" });
    const open = screen.getByRole("button", { name: "Open" }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  2401.12345 " } });
    fireEvent.click(open);
    expect(onIngestUrl).toHaveBeenCalledWith("2401.12345");
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onBackHome).toHaveBeenCalled();
  });

  it("uploads a dropped PDF and shows errors as an alert", () => {
    const { onUploadPdf } = setup([], { uploadError: "Simulation generation failed (500)" });
    const file = new File(["%PDF"], "paper.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByRole("button", { name: /Drop a PDF here/ }), { dataTransfer: { files: [file] } });
    expect(onUploadPdf).toHaveBeenCalledWith(file);
    expect(screen.getByRole("alert").textContent).toContain("Simulation generation failed (500)");
  });
});
