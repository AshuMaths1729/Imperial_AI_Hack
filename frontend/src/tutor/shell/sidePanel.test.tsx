import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SidePanel } from "./SidePanel";
import type { Caption } from "./session";

vi.mock("./api", () => ({ getTrack: vi.fn(async () => ({ track: null, lessons: [] })) }));

afterEach(cleanup);

const cap = (id: string, text: string): Caption => ({ id, who: "tutor", text, final: true });

describe("SidePanel transcript", () => {
  it("survives caption updates when scrollIntoView returns a Promise (Chrome/Safari)", () => {
    // Recent Chromium and WebKit return a Promise from scrollIntoView; an effect that returns it
    // gives React a non-function "cleanup" and crashes the page on the next caption.
    Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as Element["scrollIntoView"];
    const props = { trackId: "t1", live: true, tutorName: "Kenji" };
    const { rerender } = render(<SidePanel {...props} captions={[cap("a", "Hello")]} />);
    expect(() => rerender(<SidePanel {...props} captions={[cap("a", "Hello"), cap("b", "Let's begin")]} />)).not.toThrow();
    expect(screen.getByText("Let's begin")).toBeTruthy();
  });
});
