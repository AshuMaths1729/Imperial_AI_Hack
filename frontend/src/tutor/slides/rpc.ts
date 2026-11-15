// LiveKit RPC handlers for the stage tabs and the Slides tab (same pattern as board/rpc.ts).
import type { SlidesHandle, StageTab } from "./types";

export type StageHandle = {
  showTab(tab: StageTab): void;
  slides: SlidesHandle | null;
  /** Clears a student's circle mark wherever it is (slides or whiteboard). */
  clearCircle(circleId: string): void;
};
export type SlidesRpcMethod =
  | "ui.show_tab"
  | "ui.clear_circle"
  | "slides.explain"
  | "slides.explain_step"
  | "slides.explain_close"
  | "slides.go"
  | "slides.step"
  | "slides.point"
  | "slides.describe"
  | "slides.push"
  | "slides.edit";

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
    // The shell routes it to the slides and the board: whichever holds that circle removes it.
    "ui.clear_circle": wrap((stage, p) => {
      if (typeof p.circle_id !== "string" || !p.circle_id) return { ok: false, errors: ["circle_id must be the id from the circle event"] };
      stage.clearCircle(p.circle_id);
      return { ok: true, errors: [], circle_id: p.circle_id };
    }),
    "slides.go": drive((s, p) => s.go(Number(p.index))),
    "slides.step": drive((s, p) => s.step(Number(p.step))),
    "slides.point": drive((s, p) => s.point(String(p.id ?? ""), typeof p.hold_ms === "number" ? p.hold_ms : undefined)),
    "slides.push": drive((s, p) => s.push(p.slide)),
    // v3.2 WS-B: the explanation pop-up
    "slides.explain": drive((s, p) => s.explain(p.slide)),
    "slides.explain_step": drive((s, p) => s.explainStep(Number(p.step))),
    "slides.explain_close": drive((s) => s.closeExplanation()),
    "slides.edit": drive((s, p) => s.edit({ objects: p.objects as unknown[] | undefined, steps: p.steps as unknown[] | undefined })),
    "slides.describe": wrap((stage, p) => {
      if (!stage.slides) return { ok: false, errors: ["no slides are loaded for this lesson"] };
      const d = stage.slides.describe();
      const slide = p.slide ? stage.slides.current() : null;
      // the full slide rides along only if the whole reply still fits
      return slide && bytes({ ...d, slide }) <= RPC_REPLY_LIMIT ? { ...d, slide } : d;
    }),
  };
}
