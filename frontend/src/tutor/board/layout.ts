import type { Box } from "../contracts/types";

export type { Box } from "../contracts/types";

export const BOARD = 1000;
export const MARGIN = 20;
export const GAP = 20;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const onBoard = (b: Box) => b.x >= MARGIN && b.y >= MARGIN && b.x + b.w <= BOARD - MARGIN && b.y + b.h <= BOARD - MARGIN;
const free = (b: Box, occupied: Map<string, Box>) => onBoard(b) && [...occupied.values()].every((o) => !overlaps(b, o));

/** Turn a semantic place ("next", "below:id", "right_of:id", "region:x,y,w,h") into a board-unit box. */
export function resolvePlace(place: string, size: { w: number; h: number }, occupied: Map<string, Box>): Box {
  const w = Math.min(size.w, BOARD - 2 * MARGIN);
  const h = Math.min(size.h, BOARD - 2 * MARGIN);
  let want: Box | undefined;

  const rel = /^(below|right_of):(.+)$/.exec(place);
  const anchor = rel && occupied.get(rel[2]);
  if (anchor) {
    want = rel[1] === "below"
      ? { x: anchor.x, y: anchor.y + anchor.h + GAP, w, h }
      : { x: anchor.x + anchor.w + GAP, y: anchor.y, w, h };
  }
  const reg = /^region:(\d+),(\d+),(\d+),(\d+)$/.exec(place);
  if (reg) {
    const [rx, ry, rw, rh] = reg.slice(1).map(Number);
    const s = Math.min(rw / w, rh / h);
    const fw = w * s, fh = h * s;
    want = { x: rx + (rw - fw) / 2, y: ry + (rh - fh) / 2, w: fw, h: fh };
  }
  if (want && free(want, occupied)) return want;
  return next(w, h, occupied);
}

/** First free slot scanning rows top-to-bottom, left-to-right; candidates align with existing edges. */
function next(w: number, h: number, occupied: Map<string, Box>): Box {
  const boxes = [...occupied.values()];
  const xs = [MARGIN, ...boxes.map((b) => b.x + b.w + GAP)].sort((a, b) => a - b);
  const ys = [MARGIN, ...boxes.map((b) => b.y + b.h + GAP)].sort((a, b) => a - b);
  for (const y of ys) for (const x of xs) {
    const b = { x, y, w, h };
    if (free(b, occupied)) return b;
  }
  // shortcut: a full board overlaps the top-left corner; the tutor is expected to clear_tutor_layer.
  return { x: MARGIN, y: MARGIN, w, h };
}
