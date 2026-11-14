import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CaptionsOverlay, captionTail } from "./CaptionsOverlay";

afterEach(cleanup);

describe("captions", () => {
  it("keeps short text whole", () => {
    expect(captionTail("So the slope is two", 80)).toBe("So the slope is two");
  });

  it("truncates from the left at a word boundary, keeping the latest words", () => {
    const t = captionTail("one two three four five six seven", 20);
    expect(t).toBe("…four five six seven");
    expect(t.length).toBeLessThanOrEqual(21);
  });

  it("shows one line: the latest words of the current speaker only", () => {
    const long = `${"earlier words ".repeat(20)}and now the gradient is two x`;
    render(<CaptionsOverlay tutorName="Kenji" captions={[
      { id: "a", who: "you", text: "what is a tangent", final: true },
      { id: "b", who: "tutor", text: long, final: false },
    ]} />);
    const bar = screen.getByTestId("captions-overlay");
    expect(bar.textContent).toContain("Kenji");
    expect(bar.textContent).toMatch(/and now the gradient is two x$/);
    expect(bar.textContent).not.toContain("what is a tangent");
    expect(bar.querySelectorAll("p")).toHaveLength(1);
    expect(bar.querySelector("p")!.className).toContain("whitespace-nowrap");
  });
});
