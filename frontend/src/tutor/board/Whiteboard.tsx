"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { Box as PageBox, DefaultColorStyle, Tldraw, type Editor, type TLDefaultColorStyle, type TLShape } from "tldraw";
import "tldraw/tldraw.css";
import "katex/dist/katex.min.css";
import type { ApplyResult, BoardDescription, BoardHandle, BoardItem, BoardOp, Box, CircleEvent } from "../contracts/types";
import { downscaleDims, itemsInRegion, lassoRegion } from "./circle";
import { boardIdOf, describeShapes } from "./describe";
import { BOARD, resolvePlace } from "./layout";
import { validateOp } from "./ops";
import { BOARD_SCALE as S, createShapeId, generateId, imageAsset, imageAssetId, naturalSize, opToShapePartials } from "./toShapes";
import { MathShapeUtil, measureMath, preloadMathFonts } from "./shapes/MathShape";
import { PlotShapeUtil, plotYDomain } from "./shapes/PlotShape";

const shapeUtils = [MathShapeUtil, PlotShapeUtil];

// Unrevealed stepped shapes are not rendered, hit-tested or selectable (opacity alone is not enough).
const hideUnrevealed = (s: TLShape) => (s.opacity === 0 ? "hidden" : "inherit");
const toBoard = (b: { x: number; y: number; w: number; h: number }): Box =>
  ({ x: Math.round(b.x / S), y: Math.round(b.y / S), w: Math.round(b.w / S), h: Math.round(b.h / S) });
const shapesOf = (editor: Editor, id: string) => editor.getCurrentPageShapes().filter((s) => boardIdOf(s) === id);

/** What the student sees; `includeHidden` adds unrevealed stepped items (layout and highlight still need them). */
function describe(editor: Editor, includeHidden = false): BoardDescription {
  return describeShapes(editor.getCurrentPageShapes(), (s) => {
    const b = editor.getShapePageBounds(s);
    return b && toBoard(b);
  }, { includeHidden });
}

/** PNG (base64, no data: prefix) of a board region, long side ≤ 1024 px. */
async function snapshot(editor: Editor, region: Box = { x: 0, y: 0, w: BOARD, h: BOARD }): Promise<string> {
  const pw = Math.max(1, region.w * S), ph = Math.max(1, region.h * S);
  const out = downscaleDims(pw, ph);
  const ids = [...editor.getCurrentPageShapeIds()];
  if (!ids.length) {
    const c = Object.assign(document.createElement("canvas"), { width: out.w, height: out.h });
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, out.w, out.h);
    return c.toDataURL("image/png").split(",")[1];
  }
  const { blob } = await editor.toImage(ids, {
    format: "png", bounds: new PageBox(region.x * S, region.y * S, pw, ph), scale: out.w / pw, pixelRatio: 1, background: true, padding: 0,
  });
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  return url.split(",")[1];
}

function applyOne(editor: Editor, op: BoardOp): string | undefined {
  const items = new Map<string, BoardItem>(describe(editor, true).items.map((i) => [i.id, i]));
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
      const parts = opToShapePartials(op, items.get(op.target_id)!.bbox, S, page);
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
    const a = c(items.get(op.from_id)!.bbox), b = c(items.get(op.to_id)!.bbox);
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
  const occupied = new Map([...items].filter(([, v]) => v.type !== "arrow").map(([k, v]) => [k, v.bbox]));
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
      const shapes = editor.getCurrentPageShapes();
      const existing = new Set(shapes.map(boardIdOf));
      const student = new Set(shapes.filter((s) => s.meta.author !== "tutor").map(boardIdOf));
      const v = validateOp(raw, existing, student);
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

/** Shared tldraw board: the tutor writes via `applyOps`; the student draws freely and can circle a region to ask about it. */
export const Whiteboard = forwardRef<BoardHandle, Props>(function Whiteboard({ onCircle, className }, ref) {
  const editorRef = useRef<Editor | null>(null);
  const circling = useRef<{ prevColor: TLDefaultColorStyle } | null>(null);
  const onCircleRef = useRef(onCircle);
  onCircleRef.current = onCircle;

  const setCircleMode = (on: boolean) => {
    const editor = editorRef.current;
    if (!editor || on === !!circling.current) return;
    if (on) {
      circling.current = { prevColor: editor.getStyleForNextShape(DefaultColorStyle) };
      editor.setStyleForNextShapes(DefaultColorStyle, "violet");
      editor.setCurrentTool("draw");
    } else {
      editor.setStyleForNextShapes(DefaultColorStyle, circling.current!.prevColor);
      circling.current = null;
      editor.setCurrentTool("select");
    }
  };

  useImperativeHandle(ref, () => ({
    applyOps: (ops) => (editorRef.current ? applyOps(editorRef.current, ops) : { ok: false, ids: [], errors: ["whiteboard not ready"] }),
    describe: () => (editorRef.current ? describe(editorRef.current) : { items: [] }),
    snapshot: (region) => (editorRef.current ? snapshot(editorRef.current, region) : Promise.reject(new Error("whiteboard not ready"))),
    setCircleMode,
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
    const offAuthor = editor.sideEffects.registerBeforeCreateHandler("shape", (shape) =>
      shape.meta.author ? shape : { ...shape, meta: { ...shape.meta, author: "user" } });

    // Circle-to-Ask: the first finished stroke in circle mode is a lasso, not ink.
    const offLasso = editor.sideEffects.registerAfterChangeHandler("shape", (prev, next) => {
      if (!circling.current || next.type !== "draw" || prev.type !== "draw" || prev.props.isComplete || !next.props.isComplete) return;
      const b = editor.getShapePageBounds(next);
      setCircleMode(false);
      setTimeout(async () => {
        editor.deleteShapes([next.id]);
        if (!b) return;
        const region = lassoRegion({ x: b.x / S, y: b.y / S, w: b.w / S, h: b.h / S });
        try {
          const png_b64 = await snapshot(editor, region);
          onCircleRef.current?.({ png_b64, region, item_ids: itemsInRegion(describe(editor).items, region), source: "board" });
        } catch (e) {
          console.error("circle capture failed", e);
        }
      });
    });
    return () => { offAuthor(); offLasso(); ro.disconnect(); editorRef.current = null; };
  };

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }} role="region" aria-label="Shared whiteboard">
      <Tldraw shapeUtils={shapeUtils} onMount={onMount} getShapeVisibility={hideUnrevealed} />
    </div>
  );
});
