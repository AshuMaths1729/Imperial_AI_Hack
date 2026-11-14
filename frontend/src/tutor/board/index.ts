// STUB from Task 0 so other workstreams compile. WS2 (whiteboard) replaces this file entirely.
import { createElement, forwardRef } from "react";
import type { BoardHandle, BoardRpcMethod, CircleEvent } from "../contracts/types";

export type { BoardHandle, BoardDescription, CircleEvent, BoardOp, ApplyResult, Box } from "../contracts/types";

export const Whiteboard = forwardRef<BoardHandle, { onCircle?: (e: CircleEvent) => void }>(
  function Whiteboard(_props, _ref) {
    return createElement("div", { "data-testid": "whiteboard-stub" }, "Whiteboard (stub)");
  }
);

export function downscaleDims(w: number, h: number, max = 1024): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

export function makeBoardRpcHandlers(
  _getBoard: () => BoardHandle | null
): Record<BoardRpcMethod, (payload: string) => Promise<string>> {
  const notReady = async () => JSON.stringify({ ok: false, ids: [], errors: ["whiteboard not implemented"] });
  return { "board.apply": notReady, "board.describe": notReady, "board.snapshot": notReady };
}
