import type { BoardHandle, BoardRpcMethod, Box } from "../contracts/types";

type Handler = (payload: string) => Promise<string>;

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
export function makeBoardRpcHandlers(getBoard: () => BoardHandle | null): Record<BoardRpcMethod, Handler> {
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
      return { png_b64: await board.snapshot(p.region as Box | undefined) };
    }),
  };
}
