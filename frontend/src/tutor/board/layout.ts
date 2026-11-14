import type { Box } from "../contracts/types";

export type { Box } from "../contracts/types";

/** The page is a column of paper: fixed width, grows downward. */
export const BOARD_W = 1000;
export const BOARD_H = 3000;
export const MARGIN = 20;
export const GAP = 20;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const onBoard = (b: Box) => b.x >= MARGIN && b.y >= MARGIN && b.x + b.w <= BOARD_W - MARGIN && b.y + b.h <= BOARD_H - MARGIN;
const free = (b: Box, occupied: Map<string, Box>) => onBoard(b) && [...occupied.values()].every((o) => !overlaps(b, o));

/**
 * Turn a semantic place ("next", "below:id", "right_of:id", "region:x,y,w,h") into a board-unit box.
 * `groupPrev` is the previous item of the op's step group: "next" writes under it, like lines of working.
 */
export function resolvePlace(place: string, size: { w: number; h: number }, occupied: Map<string, Box>, groupPrev?: Box): Box {
  const w = Math.min(size.w, BOARD_W - 2 * MARGIN);
  const h = Math.min(size.h, BOARD_H - 2 * MARGIN);
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
  if (place === "next" && groupPrev) want = { x: groupPrev.x, y: groupPrev.y + groupPrev.h + GAP, w, h };
  if (want && free(want, occupied)) return want;
  return next(w, h, occupied, groupPrev?.x);
}

/** Below everything on the page (paper fills top to bottom), at `x` (default the left margin). */
function next(w: number, h: number, occupied: Map<string, Box>, x = MARGIN): Box {
  const bottom = Math.max(MARGIN - GAP, ...[...occupied.values()].map((b) => b.y + b.h));
  const b = { x: x + w > BOARD_W - MARGIN ? MARGIN : x, y: bottom + GAP, w, h };
  // shortcut: a full page overlaps the top-left corner; the tutor is expected to clear_tutor_layer.
  return onBoard(b) ? b : { x: MARGIN, y: MARGIN, w, h };
}

/** Default snapshot region: the full page width, from the top down past the lowest item (at least a square). */
export function contentRegion(items: { bbox: Box }[]): Box {
  const bottom = Math.max(0, ...items.map((i) => i.bbox.y + i.bbox.h));
  return { x: 0, y: 0, w: BOARD_W, h: Math.min(BOARD_H, Math.max(BOARD_W, bottom + 2 * GAP)) };
}
