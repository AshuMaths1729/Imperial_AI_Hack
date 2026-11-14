"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Tldraw, type Editor, type TLShape } from "tldraw";
import "tldraw/tldraw.css";
import "katex/dist/katex.min.css";
import type { ApplyResult, BoardHandle, BoardOp, Box, CircleEvent } from "../contracts/types";
import { BOARD, resolvePlace } from "./layout";
import { validateOp } from "./ops";
import { BOARD_SCALE as S, createShapeId, generateId, imageAsset, imageAssetId, naturalSize, opToShapePartials } from "./toShapes";
import { MathShapeUtil, measureMath, preloadMathFonts } from "./shapes/MathShape";
import { PlotShapeUtil, plotYDomain } from "./shapes/PlotShape";

const shapeUtils = [MathShapeUtil, PlotShapeUtil];

/** Board id of a shape: tutor shapes carry it in meta; user shapes use their tldraw id without "shape:". */
const boardIdOf = (s: TLShape) => (typeof s.meta.boardId === "string" ? s.meta.boardId : s.id.slice("shape:".length));
const toBoard = (b: { x: number; y: number; w: number; h: number }): Box => ({ x: b.x / S, y: b.y / S, w: b.w / S, h: b.h / S });
const shapesOf = (editor: Editor, id: string) => editor.getCurrentPageShapes().filter((s) => boardIdOf(s) === id);

/** Union bbox (board units) per board id, ignoring highlight overlays. */
function itemBoxes(editor: Editor): Map<string, { box: Box; kind: string }> {
  const out = new Map<string, { box: Box; kind: string }>();
  for (const s of editor.getCurrentPageShapes()) {
    if (s.meta.part === "highlight") continue;
    const b = editor.getShapePageBounds(s);
    if (!b) continue;
    const id = boardIdOf(s);
    const prev = out.get(id);
    const box = toBoard(b);
    if (prev) {
      const x = Math.min(prev.box.x, box.x), y = Math.min(prev.box.y, box.y);
      prev.box = { x, y, w: Math.max(prev.box.x + prev.box.w, box.x + box.w) - x, h: Math.max(prev.box.y + prev.box.h, box.y + box.h) - y };
    } else out.set(id, { box, kind: String(s.meta.kind ?? s.type) });
  }
  return out;
}

function applyOne(editor: Editor, op: BoardOp): string | undefined {
  const items = itemBoxes(editor);
  const page = editor.getCurrentPageShapes();
  switch (op.op) {
    case "erase":
      editor.deleteShapes(shapesOf(editor, op.target_id));
      return;
    case "clear_tutor_layer":
      editor.deleteShapes(page.filter((s) => s.meta.author === "tutor"));
      return;
    case "reveal_step":
      editor.animateShapes(opToShapePartials(op, { x: 0, y: 0, w: 0, h: 0 }, S, page), { animation: { duration: 250 } });
      return;
    case "highlight": {
      editor.deleteShapes(page.filter((s) => boardIdOf(s) === op.target_id && s.meta.part === "highlight"));
      const parts = opToShapePartials(op, items.get(op.target_id)!.box, S, page);
      editor.createShapes(parts);
      editor.sendToBack(parts.map((p) => p.id));
      return;
    }
  }

  // Reject an unplottable expression before touching the board.
  if (op.op === "plot_function") plotYDomain({ expr: op.expr ?? "", points: op.points ?? [], xMin: op.x_range[0], xMax: op.x_range[1] });
  const id = op.id ?? generateId();
  const replacing = shapesOf(editor, id);
  editor.deleteShapes(replacing);
  items.delete(id);

  if (op.op === "draw_arrow") {
    const c = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const a = c(items.get(op.from_id)!.box), b = c(items.get(op.to_id)!.box);
    const arrowId = createShapeId(id);
    editor.createShapes(opToShapePartials({ ...op, id }, { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }, S));
    const bind = (terminal: "start" | "end", target: string) => ({
      type: "arrow" as const, fromId: arrowId, toId: createShapeId(target),
      props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
    });
    editor.createBindings([bind("start", op.from_id), bind("end", op.to_id)]);
    return id;
  }

  // Arrows span other items; don't let them block layout.
  const occupied = new Map([...items].filter(([, v]) => v.kind !== "arrow").map(([k, v]) => [k, v.box]));
  const region = /^region:(\d+),(\d+),(\d+),(\d+)$/.exec(op.place);
  const size = op.op === "draw_shape" && region ? { w: +region[3], h: +region[4] } : naturalSize(op, (l) => toBoard({ x: 0, y: 0, ...measureMath(l) }));
  const box = resolvePlace(op.place, size, occupied);
  if (op.op === "place_image") {
    if (editor.getAsset(imageAssetId(id))) editor.deleteAssets([imageAssetId(id)]);
    editor.createAssets([imageAsset(id, op.url, box, S)]);
  }
  editor.createShapes(opToShapePartials({ ...op, id }, box, S));
  return id;
}

function applyOps(editor: Editor, ops: unknown[]): ApplyResult {
  if (!Array.isArray(ops)) return { ok: false, ids: [], errors: ["ops must be an array"] };
  const ids: string[] = [];
  const errors: string[] = [];
  ops.forEach((raw, i) => {
    try {
      const existing = new Set(editor.getCurrentPageShapes().map(boardIdOf));
      const v = validateOp(raw, existing);
      if ("error" in v) throw new Error(v.error);
      let id: string | undefined;
      editor.run(() => { id = applyOne(editor, v.op); });
      if (id) ids.push(id);
    } catch (e) {
      errors.push(`op ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { ok: errors.length === 0, ids, errors };
}

type Props = { onCircle?: (e: CircleEvent) => void; className?: string };

export const Whiteboard = forwardRef<BoardHandle, Props>(function Whiteboard({ className }, ref) {
  const editorRef = useRef<Editor | null>(null);

  useImperativeHandle(ref, () => ({
    applyOps: (ops) => (editorRef.current ? applyOps(editorRef.current, ops) : { ok: false, ids: [], errors: ["whiteboard not ready"] }),
    describe: () => ({ items: [] }),
    snapshot: async () => "",
    setCircleMode: () => {},
  }), []);

  const onMount = (editor: Editor) => {
    editorRef.current = editor;
    preloadMathFonts();
    editor.setCameraOptions({
      constraints: {
        bounds: { x: 0, y: 0, w: BOARD * S, h: BOARD * S }, padding: { x: 16, y: 16 }, origin: { x: 0.5, y: 0.5 },
        initialZoom: "fit-max", baseZoom: "fit-max", behavior: "contain",
      },
    });
    const fit = () => editor.setCamera(editor.getCamera(), { reset: true });
    fit();
    // Re-fit the whole board when the container resizes (side panels open/close).
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    ro.observe(editor.getContainer());
    // Anything not created by applyOps is the student's.
    const off = editor.sideEffects.registerBeforeCreateHandler("shape", (shape) =>
      shape.meta.author ? shape : { ...shape, meta: { ...shape.meta, author: "user" } });
    return () => { off(); ro.disconnect(); editorRef.current = null; };
  };

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }} role="region" aria-label="Shared whiteboard">
      <Tldraw shapeUtils={shapeUtils} onMount={onMount} />
    </div>
  );
});
