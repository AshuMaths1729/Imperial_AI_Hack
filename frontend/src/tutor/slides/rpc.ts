// LiveKit RPC handlers for the stage tabs and the Slides tab (same pattern as board/rpc.ts).
import type { SlidesHandle, StageTab } from "./types";

export type StageHandle = { showTab(tab: StageTab): void; slides: SlidesHandle | null };
export type SlidesRpcMethod = "ui.show_tab" | "slides.go" | "slides.step" | "slides.point" | "slides.describe" | "slides.push";

type Handler = (payload: string) => Promise<string>;
const fail = (msg: string) => JSON.stringify({ ok: false, errors: [msg] });
const TABS: StageTab[] = ["board", "slides", "screen"];
const RPC_REPLY_LIMIT = 14000; // livekit-client caps RPC payloads at 15 360 bytes
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Payloads and replies are JSON strings; a handler never throws. Driving the deck also brings the Slides tab up. */
export function makeSlidesRpcHandlers(getStage: () => StageHandle | null): Record<SlidesRpcMethod, Handler> {
  const wrap = (run: (stage: StageHandle, p: Record<string, unknown>) => unknown): Handler => async (payload) => {
    try {
      const stage = getStage();
      if (!stage) return fail("the lesson stage is not ready");
      const p: unknown = JSON.parse(payload || "{}");
      if (!p || typeof p !== "object" || Array.isArray(p)) return fail("payload must be a JSON object");
      return JSON.stringify(run(stage, p as Record<string, unknown>));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
  const drive = (run: (s: SlidesHandle, p: Record<string, unknown>) => { ok: boolean }) =>
    wrap((stage, p) => {
      if (!stage.slides) return { ok: false, errors: ["no slides are loaded for this lesson"] };
      const reply = run(stage.slides, p);
      if (reply.ok) stage.showTab("slides");
      return reply;
    });

  return {
    "ui.show_tab": wrap((stage, p) => {
      if (!TABS.includes(p.tab as StageTab)) return { ok: false, errors: [`tab must be one of ${TABS.join(", ")}`] };
      stage.showTab(p.tab as StageTab);
      return { ok: true, errors: [], tab: p.tab };
    }),
    "slides.go": drive((s, p) => s.go(Number(p.index))),
    "slides.step": drive((s, p) => s.step(Number(p.step))),
    "slides.point": drive((s, p) => s.point(String(p.id ?? ""), typeof p.hold_ms === "number" ? p.hold_ms : undefined)),
    "slides.push": drive((s, p) => s.push(p.slide)),
    "slides.describe": wrap((stage, p) => {
      if (!stage.slides) return { ok: false, errors: ["no slides are loaded for this lesson"] };
      const d = stage.slides.describe();
      const slide = p.slide ? stage.slides.current() : null;
      // the full slide rides along only if the whole reply still fits
      return slide && bytes({ ...d, slide }) <= RPC_REPLY_LIMIT ? { ...d, slide } : d;
    }),
  };
}
