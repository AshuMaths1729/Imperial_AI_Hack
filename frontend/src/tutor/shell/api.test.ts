import { afterEach, describe, expect, it, vi } from "vitest";
import { startSession, uploadPdf } from "./api";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("tutor api", () => {
  it("startSession posts track and tutor", async () => {
    const fetchMock = vi.fn(async () => ok({ url: "wss://x", token: "t", room: "r", lesson_id: "L1" }));
    vi.stubGlobal("fetch", fetchMock);

    const s = await startSession("tr1", "kenji-visual");

    expect(s).toEqual({ url: "wss://x", token: "t", room: "r", lesson_id: "L1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/tutor/session");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ track_id: "tr1", tutor_id: "kenji-visual" });
  });

  it("non-2xx throws detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "LiveKit is not configured" }), { status: 503 })));
    await expect(startSession("tr1", "kenji-visual")).rejects.toThrow("LiveKit is not configured");
  });

  it("uploadPdf posts the file (multipart `file`) to the track's PDF endpoint and returns the updated track", async () => {
    const fetchMock = vi.fn(async () => ok({ track_id: "tr 1", materials: [], knowledge_points: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const t = await uploadPdf("tr 1", new File(["%PDF"], "a.pdf", { type: "application/pdf" }));

    expect(t.track_id).toBe("tr 1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/tutor/tracks/tr%201/materials/pdf");
    expect(init.method).toBe("POST");
    expect(((init.body as FormData).get("file") as File).name).toBe("a.pdf");
  });

  it("errors carry the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 413 })));
    await expect(uploadPdf("t", new File(["%PDF"], "a.pdf"))).rejects.toMatchObject({ status: 413, message: "HTTP 413" });
  });
});
