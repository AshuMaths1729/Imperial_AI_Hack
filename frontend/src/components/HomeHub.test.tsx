import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomeHub } from "./HomeHub";

vi.mock("../tutor/shell/api", () => ({ listTracks: vi.fn(async () => []) }));

afterEach(cleanup);

describe("Home", () => {
  it("leads with the wordmark, the plain tagline and the two actions", () => {
    render(<HomeHub onSelectMode={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Athena" })).toBeTruthy();
    expect(
      screen.getByText("Learn a topic with a live tutor, play with the maths inside a paper, and see where the research agrees.")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Start a lesson/ }).getAttribute("href")).toBe("/lecture/lesson");
  });

  it("asks a research question in the Evidence Map", () => {
    const onSelectMode = vi.fn();
    render(<HomeHub onSelectMode={onSelectMode} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask a research question" }));
    expect(onSelectMode).toHaveBeenCalledWith("hypothesis");
  });

  it("shows the three modules by their plain names, each with a drawing", () => {
    const onSelectMode = vi.fn();
    render(<HomeHub onSelectMode={onSelectMode} />);
    const modules = screen.getByRole("list", { name: "Modules" });
    const cards = within(modules).getAllByRole("listitem");
    expect(cards.map((c) => c.querySelector("[id$='-name']")?.textContent)).toEqual([
      "Live Lessons",
      "Paper Simulator",
      "Evidence Map",
    ]);
    expect(within(modules).getAllByRole("img")).toHaveLength(3);
    expect(within(modules).getByRole("link", { name: "Live Lessons" }).getAttribute("href")).toBe("/lecture/lesson");

    fireEvent.click(within(modules).getByRole("button", { name: "Paper Simulator" }));
    expect(onSelectMode).toHaveBeenLastCalledWith("paper2sim");
    fireEvent.click(within(modules).getByRole("button", { name: "Evidence Map" }));
    expect(onSelectMode).toHaveBeenLastCalledWith("hypothesis");
  });

  it("has no old names, workspace divider or repeated taglines", () => {
    const { container } = render(<HomeHub onSelectMode={vi.fn()} />);
    const text = container.textContent ?? "";
    for (const old of ["PaperSim", "HypothesisGraph", "LectureUnderstanding", "Choose a workspace"]) {
      expect(text).not.toContain(old);
    }
    expect(screen.getByRole("heading", { level: 2, name: /Pick up where you left off/ })).toBeTruthy();
  });
});
