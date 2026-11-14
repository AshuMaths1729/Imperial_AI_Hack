import type { BoardHandle, BoardRpcMethod, Box } from "../contracts/types";
import { downscaleDims } from "./circle";

type Handler = (payload: string) => Promise<string>;
/** Re-encodes a PNG (base64) as JPEG (base64) with its long side ≤ maxSide. */
export type JpegEncoder = (pngB64: string, maxSide: number) => Promise<string>;

/** livekit-client caps RPC payloads at 15 360 bytes; keep the snapshot reply well under it. */
export const RPC_REPLY_LIMIT = 14000;
const SIDES = [768, 512, 384, 256];
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Largest JPEG of the snapshot whose JSON reply fits the RPC limit. `png_b64` keeps its contract name; `mime` says it is JPEG. */
export async function fitSnapshot(pngB64: string, encode: JpegEncoder, limit = RPC_REPLY_LIMIT) {
  for (const side of SIDES) {
    const reply = { png_b64: await encode(pngB64, side), mime: "image/jpeg" };
    if (bytes(JSON.stringify(reply)) <= limit) return reply;
  }
  return { ok: false, ids: [], errors: ["snapshot too large"] };
}

/** Browser JPEG encoder: white background (JPEG has no alpha), quality 0.7. */
const browserJpeg: JpegEncoder = async (pngB64, maxSide) => {
  const img = new Image();
  img.src = `data:image/png;base64,${pngB64}`;
  await img.decode();
  const { w, h } = downscaleDims(img.naturalWidth, img.naturalHeight, maxSide);
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.7).split(",")[1];
};

const isRegion = (r: unknown): r is Box => {
  const b = r as Box;
  return !!b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
};

// Same shape as a failed ApplyResult, so the agent can treat every failure alike.
const fail = (msg: string) => JSON.stringify({ ok: false, ids: [], errors: [msg] });

/**
 * LiveKit RPC handlers for the board (README §8). Payloads and replies are JSON strings;
 * a handler never throws: bad JSON, a missing board or a board error all reply `{ok:false, errors}`.
 */
export function makeBoardRpcHandlers(getBoard: () => BoardHandle | null, encodeJpeg: JpegEncoder = browserJpeg): Record<BoardRpcMethod, Handler> {
  const wrap = (run: (board: BoardHandle, payload: Record<string, unknown>) => unknown): Handler => async (payload) => {
    try {
      const board = getBoard();
      if (!board) return fail("whiteboard is not ready");
      const parsed: unknown = JSON.parse(payload || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("payload must be a JSON object");
      return JSON.stringify(await run(board, parsed as Record<string, unknown>));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    "board.apply": wrap((board, p) => (Array.isArray(p.ops) ? board.applyOps(p.ops) : { ok: false, ids: [], errors: ["payload.ops must be an array"] })),
    "board.describe": wrap((board) => board.describe()),
    "board.snapshot": wrap(async (board, p) => {
      if (p.region !== undefined && !isRegion(p.region)) return { ok: false, ids: [], errors: ["region must be {x,y,w,h} in board units with w,h > 0"] };
      return fitSnapshot(await board.snapshot(p.region as Box | undefined), encodeJpeg);
    }),
  };
}
