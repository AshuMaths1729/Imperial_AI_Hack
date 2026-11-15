import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BoardHandle } from "@/tutor/contracts/types";
import { CallView } from "./CallView";
import type { TutorSession } from "./useTutorSession";

vi.mock("./api", () => ({
  getTrack: vi.fn(async () => ({ track: { track_id: "t1", materials: [], knowledge_points: [] }, lessons: [] })),
  getLessonState: vi.fn(async () => null),
  getDeck: vi.fn(async () => ({ status: "none", source: null, deck: null, error: "", warnings: [], updated_at: null })),
}));

vi.mock("@/tutor/board", async (importOriginal) => {
  const { forwardRef, createElement } = await import("react");
  return {
    ...(await importOriginal<typeof import("@/tutor/board")>()),
    Whiteboard: forwardRef(function Whiteboard() {
      return createElement("div");
    }),
  };
});

// Stands in for WS-B's pop-up: renders into the slot when given one, else on the stage.
let stageSlot: HTMLElement | null | undefined;
vi.mock("@/tutor/slides", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/tutor/slides")>()),
  SlidesStage: ({ explanationSlot, loading }: { explanationSlot?: HTMLElement | null; loading?: boolean }) => {
    if (loading === undefined) return null; // the Review dialog's copy, not the stage's
    stageSlot = explanationSlot;
    const card = <div>Why h shrinks</div>;
    return explanationSlot ? createPortal(card, explanationSlot) : card;
  },
}));

const session = {
  setStage: vi.fn(), status: "live", captions: [], tutorSpeaking: false, mic: true, cam: false, sharing: false,
  start: vi.fn(), end: vi.fn(), sendCircle: vi.fn(), sendLost: vi.fn(), sendEvent: vi.fn(), sendText: vi.fn(),
  toggleMic: vi.fn(), toggleCam: vi.fn(), toggleShare: vi.fn(),
} as unknown as TutorSession;

async function renderCall() {
  render(<CallView session={session} boardRef={createRef<BoardHandle>()} tutorName="Kenji" trackId="t1" trackTitle="Calc" onLeave={vi.fn()} />);
  await act(async () => {});
}

const panel = () => screen.getByRole("region", { name: "Side panel" });
const option = (name: string) => within(panel()).getByRole("radio", { name });

// Node's own (file-less, undefined) localStorage shadows jsdom's, so each test gets a small in-memory one.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("explanation placement", () => {
  it("defaults to the slide: the stage gets no slot", async () => {
    await renderCall();
    expect(option("On slide").getAttribute("aria-checked")).toBe("true");
    expect(stageSlot).toBeNull();
    expect(within(panel()).queryByText("Why h shrinks")).toBeNull();
  });

  it("'In panel' docks explanations at the top of the side panel, above the tabs, and is remembered", async () => {
    await renderCall();
    fireEvent.click(option("In panel"));
    expect(option("In panel").getAttribute("aria-checked")).toBe("true");
    expect(store.get("st.explanations")).toBe("panel");

    expect(stageSlot).toBeInstanceOf(HTMLElement);
    expect(panel().contains(stageSlot!)).toBe(true);
    const tabs = within(panel()).getByRole("tablist", { name: "Lesson" });
    expect(stageSlot!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the slot takes no space unless something is rendered into it (CSS :empty)
    expect(stageSlot!.className).toContain("empty:hidden");
    within(stageSlot!).getByText("Why h shrinks");

    fireEvent.click(option("On slide"));
    expect(stageSlot).toBeNull();
    expect(store.get("st.explanations")).toBe("slide");
  });

  it("restores the saved placement", async () => {
    store.set("st.explanations", "panel");
    await renderCall();
    expect(option("In panel").getAttribute("aria-checked")).toBe("true");
    expect(panel().contains(stageSlot!)).toBe(true);
  });

  it("works when storage is blocked", async () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    await renderCall();
    expect(option("On slide").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(option("In panel"));
    expect(option("In panel").getAttribute("aria-checked")).toBe("true");
  });
});
