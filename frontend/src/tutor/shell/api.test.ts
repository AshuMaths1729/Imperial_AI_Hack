import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestPdf, startSession } from "./api";

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

  it("ingestPdf sends the file and mode as form fields like the team's upload", async () => {
    const fetchMock = vi.fn(async () => ok({ mode: "lecture", title: "T", subtitle: "", nodes: [], edges: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await ingestPdf(new File(["%PDF"], "a.pdf", { type: "application/pdf" }));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8000/api/ingest/pdf");
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("a.pdf");
    expect(form.get("mode")).toBe("lecture");
  });
});
