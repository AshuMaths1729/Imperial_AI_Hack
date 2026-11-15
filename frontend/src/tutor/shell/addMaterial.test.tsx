import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as api from "./api";
import { AddMaterial } from "./AddMaterial";

const view = (over = {}) => ({ status: "ready", source: "generated", deck: { title: "D", slides: [{ id: "s", title: "S", objects: [] }] }, error: "", warnings: [], updated_at: null, ...over });
const track = { track_id: "t1", user_id: "demo", title: "Calc", created_at: "", materials: [], knowledge_points: [{}, {}, {}] };

vi.mock("./api", () => ({
  uploadPdf: vi.fn(),
  ingestUrl: vi.fn(),
  addMaterial: vi.fn(),
  getTrack: vi.fn(),
  getDeck: vi.fn(async () => view()),
  prepareDeck: vi.fn(async () => view({ status: "generating" })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pick = (file: File) => fireEvent.change(screen.getByLabelText("Upload PDF"), { target: { files: [file] } });
const pdf = () => new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" });
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

describe("adding a PDF", () => {
  beforeEach(() => {
    vi.mocked(api.getTrack).mockResolvedValue({ track, lessons: [] } as never);
  });

  it("swaps in the model's key points once they are ready", async () => {
    const refined = { ...track, knowledge_points: [...track.knowledge_points, { ...track.knowledge_points[0], kp_id: "m0:k9" }] };
    vi.mocked(api.uploadPdf).mockResolvedValue(track as never);
    vi.mocked(api.getTrack).mockResolvedValue({ track: refined, lessons: [] } as never);
    const onAdded = vi.fn();
    render(<AddMaterial trackId="t1" onAdded={onAdded} />);
    pick(pdf());
    await screen.findByText(/Key points ready: the track now has 4\./, undefined, { timeout: 4000 });
    expect(onAdded).toHaveBeenLastCalledWith(refined);
  });

  it("uploads to the track's PDF endpoint, shows progress, then offers to prepare slides from it", async () => {
    let done!: (t: typeof track) => void;
    vi.mocked(api.uploadPdf).mockReturnValue(new Promise((r) => (done = r)) as never);
    const onAdded = vi.fn();
    render(<AddMaterial trackId="t1" onAdded={onAdded} />);
    await screen.findByText("1 animated slides ready.");
    // a deck exists already, so before the upload the button regenerates
    screen.getByRole("button", { name: /Regenerate slides/ });

    pick(pdf());
    expect(api.uploadPdf).toHaveBeenCalledWith("t1", expect.objectContaining({ name: "notes.pdf" }));
    screen.getByText("Reading the PDF…");
    expect(api.ingestUrl).not.toHaveBeenCalled();

    await act(async () => done(track));
    expect(onAdded).toHaveBeenCalledWith(track);
    expect(screen.queryByText(/Reading the PDF/)).toBeNull();
    // the upload answers at once; the model's key points are swapped in when the backend has written them
    screen.getByText(/Added notes\.pdf\. Writing its key points now/);
    // the deck status is re-read for the new material, and the button now offers to prepare slides from it
    expect(api.getDeck).toHaveBeenCalledTimes(2);
    await screen.findByText(/Prepare slides to build the lesson from it/);
    fireEvent.click(screen.getByRole("button", { name: /Prepare slides/ }));
    expect(api.prepareDeck).toHaveBeenCalledWith("t1");
    await screen.findByText(/Generating animated slides/);
  });

  it("a PDF that is too large says so", async () => {
    vi.mocked(api.uploadPdf).mockRejectedValue(httpError(413, "HTTP 413"));
    render(<AddMaterial trackId="t1" onAdded={vi.fn()} />);
    await act(async () => pick(pdf()));
    expect(screen.getByRole("alert").textContent).toMatch(/too large/);
  });

  it("an unreadable PDF says so, with the server's reason when it gives one", async () => {
    vi.mocked(api.uploadPdf).mockRejectedValue(httpError(422, "HTTP 422"));
    render(<AddMaterial trackId="t1" onAdded={vi.fn()} />);
    await act(async () => pick(pdf()));
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't read that PDF/);

    vi.mocked(api.uploadPdf).mockRejectedValue(httpError(400, "No text found in the PDF"));
    await act(async () => pick(pdf()));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't read that PDF: No text found in the PDF");
  });

  it("a non-PDF file is refused without uploading", async () => {
    render(<AddMaterial trackId="t1" onAdded={vi.fn()} />);
    await act(async () => pick(new File(["hi"], "notes.docx", { type: "application/msword" })));
    expect(api.uploadPdf).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/isn't a PDF/);
  });

  it("the server being unreachable says so", async () => {
    vi.mocked(api.uploadPdf).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AddMaterial trackId="t1" onAdded={vi.fn()} />);
    await act(async () => pick(pdf()));
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't reach the server/);
  });
});
