import type { TLShape } from "tldraw";
import type { BoardPlugin, Box, IdleEvent } from "../../contracts/types";
import { downscaleDims } from "../circle";
import { boardIdOf, union } from "../describe";
import type { JpegEncoder } from "../rpc";

/** Quiet time after the student's last finished stroke before the tutor takes a look. */
export const IDLE_MS = 6000;
const PAD = 40; // board units of context around the recent ink
const MAX_BYTES = 60_000; // text streams have no hard cap; keep the agent's vision call quick
const SIDES = [768, 512, 384, 256];

/** Recent-ink bounds padded and clipped to the 1000×3000 board. */
export function padRegion(b: Box, pad = PAD): Box {
  const x = Math.max(0, Math.round(b.x - pad)), y = Math.max(0, Math.round(b.y - pad));
  return { x, y, w: Math.min(1000, Math.round(b.x + b.w + pad)) - x, h: Math.min(3000, Math.round(b.y + b.h + pad)) - y };
}

/** JPEG on white (no alpha), quality 0.7, long side ≤ maxSide. */
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

type Options = { encodeJpeg?: JpegEncoder; maxBytes?: number };

/** Watches the student's ink and emits one "tutor.idle" IdleEvent per pause (they wrote, then stopped ~6 s). */
export const makeIdlePlugin = ({ encodeJpeg = browserJpeg, maxBytes = MAX_BYTES }: Options = {}): BoardPlugin =>
  ({ editor, emit, snapshot, describe }) => {
    const recent = new Set<string>(); // board ids of student shapes written since the last event
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastDone = 0;

    const fire = async () => {
      const ids = new Set(recent);
      recent.clear();
      const items = describe().items.filter((i) => i.author === "user" && ids.has(i.id));
      if (!items.length) return;
      const region = padRegion(items.map((i) => i.bbox).reduce(union));
      try {
        const png = await snapshot(region);
        for (const side of SIDES) {
          const ev: IdleEvent = {
            png_b64: await encodeJpeg(png, side), mime: "image/jpeg", region, item_ids: items.map((i) => i.id), idle_ms: Date.now() - lastDone,
          };
          if (JSON.stringify(ev).length <= maxBytes) return emit("tutor.idle", ev);
        }
      } catch (e) {
        console.error("idle capture failed", e);
      }
    };

    const touch = (s: TLShape) => {
      if (s.meta.author !== "user") return;
      recent.add(boardIdOf(s));
      clearTimeout(timer);
      if (s.type === "draw" && !(s.props as { isComplete?: boolean }).isComplete) return; // pen still down
      lastDone = Date.now();
      timer = setTimeout(fire, IDLE_MS);
    };

    const offCreate = editor.sideEffects.registerAfterCreateHandler("shape", touch);
    const offChange = editor.sideEffects.registerAfterChangeHandler("shape", (_prev, next) => touch(next));
    // Erased ink — and the Circle-to-Ask lasso, deleted right after it is drawn — is not something to check.
    const offDelete = editor.sideEffects.registerAfterDeleteHandler("shape", (s) => {
      if (recent.delete(boardIdOf(s)) && !recent.size) clearTimeout(timer);
    });
    return () => { offCreate(); offChange(); offDelete(); clearTimeout(timer); };
  };

export const idlePlugin: BoardPlugin = makeIdlePlugin();
