// Type-only tldraw import: the runtime package needs a real browser, so this module stays testable in jsdom.
import type { IndexKey, JsonObject, TLAssetId, TLImageAsset, TLRichText, TLShape, TLShapeId, TLShapePartial } from "tldraw";
import type { BoardOp, Box } from "../contracts/types";

// Custom tutor shapes (rendered by shapes/MathShape.tsx and shapes/PlotShape.tsx).
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    math: { w: number; h: number; latex: string };
    plot: { w: number; h: number; expr: string; points: number[][]; xMin: number; xMax: number; label: string };
  }
}

/** Page units per board unit. The camera zooms the 1000×1000 board to fit the viewport. */
export const BOARD_SCALE = 1;

const HIGHLIGHT_PAD = 8;
const CAPTION_H = 36;

export type TutorMeta = {
  author: "tutor";
  boardId: string;
  kind: string;
  part?: "caption" | "highlight";
  group?: string;
  step?: number;
};

// Same output as tldraw's createShapeId / toRichText.
export const createShapeId = (id: string) => `shape:${id}` as TLShapeId;
export const toRichText = (text: string): TLRichText => ({
  type: "doc",
  content: text.split("\n").map((t) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" })),
});

export const tutorShapeId = (boardId: string, part?: string): TLShapeId => createShapeId(part ? `${boardId}__${part}` : boardId);
export const imageAssetId = (boardId: string) => `asset:${boardId}` as TLAssetId;

let counter = 0;
export const generateId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Natural size of a drawable op in board units, before layout. Math can pass a real DOM measurement. */
export function naturalSize(op: BoardOp, measureMath?: (latex: string) => { w: number; h: number }): { w: number; h: number } {
  switch (op.op) {
    case "write_text": {
      // ~13 units per char at tldraw size "m" sans; wrap at 560 units.
      const lines = op.text.split("\n");
      const longest = Math.max(...lines.map((l) => l.length));
      const w = Math.min(560, Math.max(60, longest * 13 + 16));
      const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 13) / w)), 0);
      return { w, h: rows * 33 + 8 };
    }
    case "write_math":
      return measureMath?.(op.latex) ?? { w: Math.min(900, Math.max(80, op.latex.length * 10)), h: 64 };
    case "plot_function":
      return { w: 360, h: 240 };
    case "draw_shape":
      return op.shape === "line" ? { w: 300, h: 20 } : { w: 200, h: 110 };
    case "place_image":
      return { w: 320, h: 240 + (op.caption ? CAPTION_H : 0) };
    default:
      return { w: 0, h: 0 };
  }
}

/**
 * Pure mapping from one validated op to tldraw shape partials.
 * `box` is in board units; for draw_arrow it encodes start (x,y) and delta (w,h);
 * for highlight it is the target's bbox. `shapes` (current page shapes) is only read by reveal_step and highlight.
 */
export function opToShapePartials(op: BoardOp, box: Box, scale: number, shapes: TLShape[] = []): TLShapePartial[] {
  const x = box.x * scale, y = box.y * scale, w = box.w * scale, h = box.h * scale;

  if (op.op === "reveal_step") {
    return shapes
      .filter((s) => s.meta.group === op.group_id && typeof s.meta.step === "number")
      .map((s) => ({ id: s.id, type: s.type, opacity: (s.meta.step as number) <= op.step ? 1 : 0 }));
  }
  if (op.op === "highlight") {
    const target = shapes.find((s) => s.meta.boardId === op.target_id && !s.meta.part) ?? shapes.find((s) => s.id === createShapeId(op.target_id));
    const meta: TutorMeta = { author: "tutor", boardId: op.target_id, kind: "highlight", part: "highlight" };
    if (typeof target?.meta.group === "string") Object.assign(meta, { group: target.meta.group, step: target.meta.step });
    return [{
      id: tutorShapeId(op.target_id, "highlight"), type: "geo",
      x: x - HIGHLIGHT_PAD, y: y - HIGHLIGHT_PAD, opacity: target?.opacity ?? 1, meta: meta as JsonObject,
      props: { geo: "rectangle", w: w + 2 * HIGHLIGHT_PAD, h: h + 2 * HIGHLIGHT_PAD, color: op.color ?? "yellow", fill: "solid", dash: "solid", size: "s" },
    }];
  }
  if (op.op === "erase" || op.op === "clear_tutor_layer") return [];

  const boardId = op.id ?? generateId();
  const meta = (kind: string, part?: TutorMeta["part"]): JsonObject => {
    const m: TutorMeta = { author: "tutor", boardId, kind };
    if (part) m.part = part;
    if (op.group) m.group = op.group;
    if (op.step) m.step = op.step;
    return m as JsonObject;
  };
  // hidden until reveal_step, which finds shapes by group: a stepped op without one could never be revealed
  const base = { id: tutorShapeId(boardId), x, y, opacity: op.step && op.group ? 0 : 1 };

  switch (op.op) {
    case "write_text":
      return [{ ...base, type: "text", meta: meta("text"), props: { richText: toRichText(op.text), w, autoSize: false, size: "m", font: "sans", color: "black", textAlign: "start" } }];
    case "write_math":
      return [{ ...base, type: "math", meta: meta("math"), props: { w, h, latex: op.latex } }];
    case "plot_function":
      return [{ ...base, type: "plot", meta: meta("plot"), props: { w, h, expr: op.expr ?? "", points: op.points ?? [], xMin: op.x_range[0], xMax: op.x_range[1], label: op.label ?? "" } }];
    case "draw_shape":
      if (op.shape === "line") {
        const pt = (id: string, px: number) => ({ id, index: id as IndexKey, x: px, y: h / 2 });
        return [{ ...base, type: "line", meta: meta("line"), props: { points: { a1: pt("a1", 0), a2: pt("a2", w) }, color: "black", size: "m", dash: "solid" } }];
      }
      return [{
        ...base, type: "geo", meta: meta(op.shape),
        props: { geo: op.shape === "rect" ? "rectangle" : "ellipse", w, h, richText: toRichText(op.label ?? ""), color: "blue", fill: "none", dash: "solid", size: "m", font: "sans" },
      }];
    case "draw_arrow":
      return [{
        ...base, type: "arrow", meta: meta("arrow"),
        props: { start: { x: 0, y: 0 }, end: { x: w, y: h }, richText: toRichText(op.label ?? ""), color: "black", size: "m", dash: "solid", font: "sans", arrowheadEnd: "arrow" },
      }];
    case "place_image": {
      const imgH = op.caption ? h - CAPTION_H * scale : h;
      const out: TLShapePartial[] = [{ ...base, type: "image", meta: meta("image"), props: { assetId: imageAssetId(boardId), w, h: imgH, altText: op.caption ?? "" } }];
      if (op.caption)
        out.push({
          ...base, id: tutorShapeId(boardId, "caption"), type: "text", y: y + imgH + 4 * scale, meta: meta("image", "caption"),
          props: { richText: toRichText(op.caption), w, autoSize: false, size: "s", font: "sans", color: "grey", textAlign: "middle" },
        });
      return out;
    }
  }
}

/** Asset record a place_image shape points at (created before the shape). */
export function imageAsset(boardId: string, url: string, box: Box, scale: number): TLImageAsset {
  return {
    id: imageAssetId(boardId), typeName: "asset", type: "image", meta: {},
    props: { name: boardId, src: url, w: box.w * scale, h: box.h * scale, mimeType: null, isAnimated: false },
  };
}
