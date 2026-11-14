import type { BoardItem, Box } from "../contracts/types";
import { BOARD } from "./layout";

export type { CircleEvent } from "../contracts/types";

/** Ids of items with at least half their bbox inside `region` (flat items: centre inside). */
export function itemsInRegion(items: BoardItem[], region: Box): string[] {
  return items
    .filter(({ bbox: b }) => {
      const area = b.w * b.h;
      if (area === 0) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h;
      }
      const ix = Math.max(0, Math.min(b.x + b.w, region.x + region.w) - Math.max(b.x, region.x));
      const iy = Math.max(0, Math.min(b.y + b.h, region.y + region.h) - Math.max(b.y, region.y));
      return ix * iy >= area / 2;
    })
    .map((i) => i.id);
}

/** Output size with the long side capped at `max`, keeping aspect ratio; never upscales. */
export function downscaleDims(w: number, h: number, max = 1024): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

const MIN_REGION = 32; // a tap still yields a usable crop

/** Lasso bounds (board units) → integer region clipped to the board, at least 32×32. */
export function lassoRegion(b: Box): Box {
  const axis = (start: number, size: number): [number, number] => {
    let lo = Math.max(0, start), hi = Math.min(BOARD, start + size);
    if (hi - lo < MIN_REGION) {
      lo = Math.min(Math.max(0, (lo + hi) / 2 - MIN_REGION / 2), BOARD - MIN_REGION);
      hi = lo + MIN_REGION;
    }
    return [Math.round(lo), Math.round(hi - lo)];
  };
  const [x, w] = axis(b.x, b.w), [y, h] = axis(b.y, b.h);
  return { x, y, w, h };
}
