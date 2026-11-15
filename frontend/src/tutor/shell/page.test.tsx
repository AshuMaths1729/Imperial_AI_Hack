import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import TutorPage from "@/app/tutor/page";
import gd from "@/tutor/slides/decks/gradient-descent.json";
import * as api from "./api";
import { makeSlidesRpcHandlers } from "@/tutor/slides";
import { pointOnStage, type ShellStage } from "./session";
import type { TutorSession } from "./useTutorSession";

const deckView = (over = {}) => ({ status: "none", source: "fallback", deck: gd, error: "", warnings: [], updated_at: null, ...over });

vi.mock("./api", () => ({
  listTutors: vi.fn(async () => [
    { tutor_id: "kenji-visual", name: "Kenji", avatar_id: "a", voice_id: "v1", style_prompt: "visual explainer: draws first, then explains" },
    { tutor_id: "kenji-socratic", name: "Kenji S", avatar_id: "a", voice_id: "v2", style_prompt: "Socratic coach: asks guiding questions" },
    { tutor_id: "kenji-examples", name: "Kenji E", avatar_id: "a", voice_id: "v3", style_prompt: "worked examples: solves a similar problem" },
  ]),
  listTracks: vi.fn(async () => [
    { track_id: "t1", user_id: "demo", title: "Gradient Descent", materials: [], knowledge_points: [], created_at: "" },
  ]),
  getTrack: vi.fn(async () => ({
    track: { track_id: "t1", user_id: "demo", title: "Gradient Descent", materials: [], knowledge_points: [], created_at: "" },
    lessons: [],
  })),
  createTrack: vi.fn(),
  addMaterial: vi.fn(async () => ({
    track_id: "t1", user_id: "demo", title: "Gradient Descent", materials: [], knowledge_points: [], created_at: "",
  })),
  uploadPdf: vi.fn(),
  getDeck: vi.fn(async () => deckView()),
  getLessonState: vi.fn(async () => ({
    slide: 1, step: 0, idea: "", detours: [],
    concepts: [{ concept: "what the loss measures", level: "got_it", evidence: "", anchor: "", tries: 1 }],
  })),
  prepareDeck: vi.fn(async () => deckView({ status: "generating" })),
  ingestUrl: vi.fn(async () => ({ mode: "lecture", title: "Paper", subtitle: "", nodes: [{}, {}, {}], edges: [] })),
}));

// The real tldraw board can't render in jsdom; these tests cover the call layout, not the board.
vi.mock("@/tutor/board", async (importOriginal) => {
  const { forwardRef, createElement } = await import("react");
  return {
    ...(await importOriginal<typeof import("@/tutor/board")>()),
    Whiteboard: forwardRef(function Whiteboard() {
      return createElement("div", { "data-testid": "whiteboard" });
    }),
  };
});

let session: TutorSession;
let stage: ShellStage | null = null;
vi.mock("./useTutorSession", () => ({ useTutorSession: () => session }));

function fakeSession(over: Partial<TutorSession> = {}): TutorSession {
  return {
    setStage: vi.fn((h) => {
      stage = h;
    }),
    status: "idle",
    error: undefined,
    lessonId: undefined,
    avatarVideo: undefined,
    selfVideo: undefined,
    screenTrack: undefined,
    captions: [],
    tutorSpeaking: false,
    start: vi.fn(async () => {}),
    end: vi.fn(),
    sendCircle: vi.fn(),
    sendLost: vi.fn(),
    sendEvent: vi.fn(),
    micError: undefined,
    sendText: vi.fn(),
    mic: true,
    toggleMic: vi.fn(async () => {}),
    cam: false,
    toggleCam: vi.fn(async () => {}),
    sharing: false,
    toggleShare: vi.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  session = fakeSession();
});
afterEach(cleanup);

async function pickTutorAndTrack() {
  fireEvent.click(await screen.findByRole("radio", { name: /Kenji S/ }));
  fireEvent.change(await screen.findByLabelText("Learning track"), { target: { value: "t1" } });
}

describe("/tutor page", () => {
  it("lobby disables Join until tutor and track are picked", async () => {
    render(<TutorPage />);
    const join = (await screen.findByRole("button", { name: "Join lesson" })) as HTMLButtonElement;
    expect(join.disabled).toBe(true);

    fireEvent.click(await screen.findByRole("radio", { name: /Kenji S/ }));
    expect(join.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Learning track"), { target: { value: "t1" } });
    expect(join.disabled).toBe(false);

    fireEvent.click(join);
    expect(session.start).toHaveBeenCalledWith("t1", "kenji-socratic");
  });

  it("shows the error message when start fails", async () => {
    session = fakeSession({ status: "error", error: "Tutor didn't join — is the agent running?" });
    render(<TutorPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("Tutor didn't join — is the agent running?");
    screen.getByRole("button", { name: "Join lesson" });
  });

  it("control bar has Leave and I'm lost, and I'm lost calls sendLost", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    fireEvent.click(await screen.findByRole("button", { name: "I'm lost" }));
    expect(session.sendLost).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(session.end).toHaveBeenCalledTimes(1);
  });

  it("CC toggles the captions overlay", async () => {
    session = fakeSession({
      status: "live",
      captions: [{ id: "s1", who: "tutor", text: "So the momentum term keeps us moving", final: true }],
    });
    render(<TutorPage />);
    expect((await screen.findByTestId("captions-overlay")).textContent).toContain("So the momentum term keeps us moving");

    fireEvent.click(screen.getByRole("button", { name: "Captions" }));
    expect(screen.queryByTestId("captions-overlay")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Captions" }));
    screen.getByTestId("captions-overlay");
  });

  it("adding a URL to a track reports the knowledge points added", async () => {
    render(<TutorPage />);
    await pickTutorAndTrack();
    fireEvent.change(screen.getByLabelText("Material URL"), { target: { value: "https://arxiv.org/abs/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add URL" }));
    await screen.findByText("Added 3 knowledge points");
  });
});

describe("slides", () => {
  it("lobby shows the track's deck and Prepare slides starts generation", async () => {
    render(<TutorPage />);
    await pickTutorAndTrack();
    await screen.findByText("Using the built-in 7-slide deck.");
    fireEvent.click(screen.getByRole("button", { name: /Prepare slides/ }));
    await screen.findByText(/Generating animated slides/);
    expect(api.prepareDeck).toHaveBeenCalledWith("t1");
    expect((screen.getByRole("button", { name: /Prepare slides/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the call has a Slides tab showing the deck", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Slides" }));
    expect(screen.getByRole("tab", { name: "Slides" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByRole("region", { name: /Slide 1 of 7: Lost in the fog/ });
  });

  it("a blocked microphone shows how to fix it, and the lesson stays usable", async () => {
    session = fakeSession({ status: "live", lessonId: "L1", micError: "Microphone blocked. Meanwhile you can type to the tutor." });
    render(<TutorPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Microphone blocked/);
    expect(screen.getByPlaceholderText("Type to the tutor…")).toBeTruthy();
  });

  it("a hidden Slides tab paints nothing over the whiteboard", async () => {
    // Slide animations set visibility:visible on their own dots and lines, which beats a parent's visibility:hidden.
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    const slide = await screen.findByRole("region", { name: /Slide 1 of 7/ });
    const pane = slide.closest(".absolute.inset-0") as HTMLElement;
    expect(pane.className).toContain("opacity-0");
    fireEvent.click(screen.getByRole("tab", { name: "Slides" }));
    expect(pane.className).not.toContain("opacity-0");
  });

  it("switching tabs cross-fades with a short label, then fully hides the old pane", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    const slide = await screen.findByRole("region", { name: /Slide 1 of 7/ });
    const slidesPane = slide.closest(".absolute.inset-0") as HTMLElement;
    const boardPane = screen.getByTestId("whiteboard").closest(".absolute.inset-0") as HTMLElement;
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("tab", { name: "Slides" }));
      screen.getByText("Back to the slides…");
      expect(slidesPane.className).not.toContain("opacity-0");
      // the board fades out underneath: still painted, but no longer clickable
      expect(boardPane.className).toContain("opacity-0");
      expect(boardPane.className).toContain("pointer-events-none");
      expect(boardPane.className).not.toContain("invisible");
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.queryByText("Back to the slides…")).toBeNull();
      expect(boardPane.className).toContain("invisible");

      act(() => stage!.showTab("board")); // the agent switches the same way
      screen.getByText("Moving to the whiteboard…");
      act(() => void vi.advanceTimersByTime(1000));
      expect(slidesPane.className).toContain("invisible opacity-0 pointer-events-none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the agent switches tabs and drives the deck through the session's stage handle", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    await screen.findByRole("region", { name: /Slide 1 of 7/ });
    act(() => stage!.showTab("slides"));
    expect(screen.getByRole("tab", { name: "Slides" }).getAttribute("aria-selected")).toBe("true");
    let r;
    act(() => {
      r = stage!.slides!.go(4);
    });
    expect(r).toMatchObject({ ok: true, index: 4, step: 0 });
    await screen.findByRole("region", { name: /Slide 4 of 7: One step downhill/ });
    act(() => {
      r = stage!.slides!.step(9);
    });
    expect(r).toMatchObject({ ok: false });
    expect(stage!.slides!.describe().current!.id).toBe("update");
    act(() => stage!.showTab("board"));
    expect(screen.getByRole("tab", { name: "Whiteboard" }).getAttribute("aria-selected")).toBe("true");
  });

  it("student can step through slides with the controls", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    await screen.findByRole("region", { name: /Slide 1 of 7/ });
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByLabelText("Step 4 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("region", { name: /Slide 2 of 7: What the loss measures/ });
  });
});

describe("F3: back to the slides after a whiteboard explanation", () => {
  // What connectLesson does for board.apply: the stage goes to the board, then the tutor explains there.
  const explainOnBoard = () => act(() => stage!.showTab("board"));
  const selected = () => screen.getAllByRole("tab", { selected: true }).map((t) => t.textContent);

  it.each([
    ["slides.go", { index: 3 }],
    ["slides.step", { step: 2 }],
    ["slides.point", { id: "loss" }],
    ["ui.show_tab", { tab: "slides" }],
  ] as const)("%s brings the slides back and fully hides the board", async (method, payload) => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    const slide = await screen.findByRole("region", { name: /Slide 1 of 7/ });
    const rpc = makeSlidesRpcHandlers(() => stage);
    await act(async () => void (await rpc["ui.show_tab"](JSON.stringify({ tab: "slides" }))));
    if (method === "slides.point") await act(async () => void (await rpc["slides.step"](JSON.stringify({ step: 1 }))));
    vi.useFakeTimers();
    try {
      explainOnBoard();
      act(() => void vi.advanceTimersByTime(1000));
      expect(selected()).toContain("Whiteboard");
      expect(stage!.tab()).toBe("board");

      let reply = "";
      await act(async () => void (reply = await rpc[method](JSON.stringify(payload))));
      expect(JSON.parse(reply).ok).toBe(true);
      expect(selected()).toContain("Slides");
      expect(stage!.tab()).toBe("slides");
      act(() => void vi.advanceTimersByTime(1000));
      const boardPane = screen.getByTestId("whiteboard").closest(".absolute.inset-0") as HTMLElement;
      expect(boardPane.className).toContain("invisible opacity-0 pointer-events-none");
      expect((slide.closest(".absolute.inset-0") as HTMLElement).className).not.toContain("opacity-0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the tutor saying a tagged word for a slide object brings the slides back, even with no slide call", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    render(<TutorPage />);
    await screen.findByRole("region", { name: /Slide 1 of 7/ });
    act(() => stage!.slides!.step(1));
    explainOnBoard();
    const board = { applyOps: vi.fn(() => ({ ok: false, ids: [], errors: ['point_at: unknown id "title"'] })) };
    act(() => pointOnStage(stage, board as never, "loss"));
    expect(selected()).toContain("Slides");
  });

  it("stopping a screen share goes back to the tab that was showing before it", async () => {
    session = fakeSession({ status: "live", lessonId: "L1" });
    const { rerender } = render(<TutorPage />);
    await screen.findByRole("region", { name: /Slide 1 of 7/ });
    act(() => stage!.showTab("slides"));
    session = fakeSession({ status: "live", lessonId: "L1", screenTrack: { attach: vi.fn(), detach: vi.fn() } as never });
    rerender(<TutorPage />);
    expect(selected()).toContain("Shared screen");
    session = fakeSession({ status: "live", lessonId: "L1" });
    rerender(<TutorPage />);
    expect(selected()).toContain("Slides");
  });
});

describe("lesson header", () => {
  it("shows a live mm:ss timer, ideas covered and mastery", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      session = fakeSession({ status: "live", lessonId: "L1" });
      render(<TutorPage />);
      await screen.findByRole("region", { name: /Slide 1 of 7/ });
      expect(screen.getByLabelText(/Lesson time/).textContent).toBe("00:00");
      act(() => void vi.advanceTimersByTime(65_000));
      expect(screen.getByLabelText(/Lesson time/).textContent).toBe("01:05");
      expect(screen.getByRole("progressbar", { name: "Progress" }).getAttribute("aria-valuetext")).toBe("0/7 ideas");
      // no knowledge points on the track: mastery comes from the lesson's checked concepts (1 of 1 got it)
      await vi.waitFor(() => expect(screen.getByRole("progressbar", { name: "Mastery" }).getAttribute("aria-valuetext")).toBe("100%"));
      act(() => void stage!.slides!.go(2));
      act(() => void vi.advanceTimersByTime(1000));
      expect(screen.getByRole("progressbar", { name: "Progress" }).getAttribute("aria-valuetext")).toBe("1/7 ideas");
      expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("02");
    } finally {
      vi.useRealTimers();
    }
  });

  it("downloads the transcript as plain text; it is no longer a side-panel tab", async () => {
    session = fakeSession({
      status: "live",
      lessonId: "L1",
      captions: [
        { id: "a", who: "tutor", text: "Rise over run.", final: true },
        { id: "b", who: "you", text: "Got it", final: true },
      ],
    });
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<TutorPage />);
    expect(screen.queryByRole("tab", { name: "Transcript" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Download transcript" }));
    expect(click).toHaveBeenCalled();
    expect(await blobs[0].text()).toBe("Tutor: Rise over run.\nYou: Got it\n");
    click.mockRestore();
  });
});
