import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import TutorPage from "@/app/tutor/page";
import type { TutorSession } from "./useTutorSession";

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
  ingestPdf: vi.fn(),
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
vi.mock("./useTutorSession", () => ({ useTutorSession: () => session }));

function fakeSession(over: Partial<TutorSession> = {}): TutorSession {
  return {
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
