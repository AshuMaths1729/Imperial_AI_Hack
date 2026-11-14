"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { b64Vecs, Box as PageBox, DefaultColorStyle, DefaultStylePanel, MobileStylePanel, Tldraw, type Editor, type TLComponents, type TLDefaultColorStyle, type TLShape, type TLShapePartial } from "tldraw";
import "tldraw/tldraw.css";
import "katex/dist/katex.min.css";
import type { ApplyResult, BoardDescription, BoardHandle, BoardItem, BoardOp, BoardPlugin, Box, CircleEvent } from "../contracts/types";
import { downscaleDims, itemsInRegion, lassoRegion } from "./circle";
import { annotateStrokes } from "./annotate";
import { fitBoardCamera } from "./camera";
import { boardIdOf, describeShapes, plain, union } from "./describe";
import { BoardFxLayer, disposeFx, fxFor, type BoardFx } from "./fx";
import { contentRegion, resolvePlace } from "./layout";
import { validateOp } from "./ops";
import { latexChars, writeMs } from "./pen";
import { BOARD_SCALE as S, createShapeId, generateId, imageAsset, imageAssetId, naturalSize, opToShapePartials, tutorShapeId } from "./toShapes";
import { MathShapeUtil, measureMath, preloadMathFonts } from "./shapes/MathShape";
import { PlotShapeUtil, plotYDomain } from "./shapes/PlotShape";

const shapeUtils = [MathShapeUtil, PlotShapeUtil];
// No page menu (one page; it sat over the first line of working). The always-open style panel covered the right
// of the page, so it lives behind a colour button instead (tldraw's mobile popover). The pen/laser layer moves with the camera.
const components: TLComponents = {
  PageMenu: null,
  StylePanel: (props) => (props.isMobile ? <DefaultStylePanel {...props} /> : null),
  SharePanel: () => <div style={{ margin: 6, pointerEvents: "all" }}><MobileStylePanel /></div>,
  OnTheCanvas: BoardFxLayer,
};

// Unrevealed stepped shapes are not rendered, hit-tested or selectable (opacity alone is not enough).
const hideUnrevealed = (s: TLShape) => (s.opacity === 0 ? "hidden" : "inherit");
const toBoard = (b: { x: number; y: number; w: number; h: number }): Box =>
  ({ x: Math.round(b.x / S), y: Math.round(b.y / S), w: Math.round(b.w / S), h: Math.round(b.h / S) });
const shapesOf = (editor: Editor, id: string) => editor.getCurrentPageShapes().filter((s) => boardIdOf(s) === id);
const boundsOf = (editor: Editor, shapes: TLShape[]): Box | undefined =>
  shapes.map((s) => editor.getShapePageBounds(s)).reduce<Box | undefined>((u, b) => (b ? (u ? union(u, b) : { x: b.x, y: b.y, w: b.w, h: b.h }) : u), undefined);
const WRITTEN = new Set(["text", "math"]);
const TEXT_LINE = 33; // page units per text row at size "m" (24px × 1.35)

/** Camera to an item: its whole step group stays in frame, the item itself fully visible. */
function followItem(editor: Editor, fx: BoardFx, id: string) {
  const shapes = shapesOf(editor, id);
  const anchor = boundsOf(editor, shapes);
  if (!anchor) return;
  const group = shapes[0].meta.group;
  const mates = group ? editor.getCurrentPageShapes().filter((s) => s.meta.group === group && s.opacity > 0) : [];
  const region = boundsOf(editor, mates);
  fx.follow(region ? union(region, anchor) : anchor, anchor);
}

/** Hand the pen a text/math shape that is about to become visible: it is written in, and the camera follows. */
function penWrite(editor: Editor, fx: BoardFx, shape: TLShape) {
  const b = editor.getShapePageBounds(shape);
  if (!b) return;
  const p = shape.props as { latex?: string; richText?: unknown };
  const lines = shape.type === "math" ? 1 : Math.max(1, Math.round(b.h / TEXT_LINE));
  const chars = shape.type === "math" ? latexChars(p.latex ?? "") : plain(p.richText).length;
  fx.write(shape.id, { x: b.x, y: b.y, w: b.w, h: b.h }, lines, writeMs(chars, lines), () => followItem(editor, fx, boardIdOf(shape)));
}

/** Freshly created shapes of item `id` go through the pen: written (text/math) or faded in, in order. */
function penShow(editor: Editor, fx: BoardFx, id: string) {
  const shapes = shapesOf(editor, id).filter((s) => s.opacity > 0);
  const main = shapes.find((s) => !s.meta.part);
  if (main && WRITTEN.has(main.type)) penWrite(editor, fx, main);
  else if (shapes.length) fx.appear(shapes.map((s) => s.id), () => followItem(editor, fx, id));
}

/** What the student sees; `includeHidden` adds unrevealed stepped items (layout and highlight still need them). */
function describe(editor: Editor, includeHidden = false): BoardDescription {
  return describeShapes(editor.getCurrentPageShapes(), (s) => {
    const b = editor.getShapePageBounds(s);
    return b && toBoard(b);
  }, { includeHidden });
}

/** PNG (base64, no data: prefix) of a board region, long side ≤ 1024 px. */
async function snapshot(editor: Editor, region: Box = contentRegion(describe(editor).items)): Promise<string> {
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

function applyOne(editor: Editor, fx: BoardFx, op: BoardOp): string | undefined {
  const items = new Map<string, BoardItem>(describe(editor, true).items.map((i) => [i.id, i]));
  const page = editor.getCurrentPageShapes();
  const remove = (shapes: TLShape[]) => {
    shapes.forEach((s) => fx.cancel(s.id));
    editor.deleteShapes(shapes);
  };
  switch (op.op) {
    case "erase":
      remove(shapesOf(editor, op.target_id));
      return;
    case "clear_tutor_layer":
      remove(page.filter((s) => s.meta.author === "tutor"));
      return;
    case "reveal_step": {
      // Revealed writing is written in by the pen; everything else (plots, highlights, hiding) fades.
      const was = new Map(page.map((s) => [s.id, s]));
      const parts = opToShapePartials(op, { x: 0, y: 0, w: 0, h: 0 }, S, page);
      const shown = (p: TLShapePartial) => p.opacity === 1 && was.get(p.id)?.opacity === 0;
      const written = parts.filter((p) => shown(p) && WRITTEN.has(p.type) && !was.get(p.id)!.meta.part);
      editor.updateShapes(written);
      written.forEach((p) => penWrite(editor, fx, editor.getShape(p.id)!));
      editor.animateShapes(parts.filter((p) => !written.includes(p)), { animation: { duration: 250 } });
      const others = [...new Set(parts.filter((p) => shown(p) && !written.includes(p)).map((p) => boardIdOf(was.get(p.id)!)))];
      if (!written.length && others.length) fx.after(() => followItem(editor, fx, others[others.length - 1]));
      return;
    }
    case "point_at": {
      const b = items.get(op.target_id)!.bbox;
      fx.after(() => {
        fx.point((b.x + b.w / 2) * S, (b.y + b.h / 2) * S, op.hold_ms ?? 2500);
        if (!editor.getViewportPageBounds().contains(new PageBox(b.x * S, b.y * S, b.w * S, b.h * S))) fx.follow(scaled(b));
      });
      return;
    }
    case "focus": {
      const b = scaled(op.region ?? items.get(op.target_id!)!.bbox);
      fx.after(() => fx.follow(b, b, { force: true }));
      return;
    }
    case "annotate": {
      const id = op.id ?? generateId();
      remove(shapesOf(editor, id));
      const target = op.target_id ? items.get(op.target_id)!.bbox : op.region!;
      const strokes = annotateStrokes(op.mark, target).map((pts, i) => {
        const page = pts.map((p) => ({ x: p.x * S, y: p.y * S }));
        const x = Math.min(...page.map((p) => p.x)), y = Math.min(...page.map((p) => p.y));
        return { id: tutorShapeId(id, i ? `s${i}` : undefined), x, y, points: page };
      });
      editor.createShapes(strokes.map((s) => ({
        id: s.id, type: "draw", x: s.x, y: s.y, meta: { author: "tutor", boardId: id, kind: "annotate" },
        props: {
          segments: [{ type: "free", path: b64Vecs.encodePoints(s.points.map((p) => ({ x: p.x - s.x, y: p.y - s.y, z: 0.5 }))) }],
          color: op.color ?? "red", size: "m", dash: "draw", fill: "none", isComplete: true,
        },
      })));
      fx.stroke(strokes, () => followItem(editor, fx, id));
      return id;
    }
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
  remove(shapesOf(editor, id));
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
    penShow(editor, fx, id);
    return id;
  }

  // Arrows span other items; don't let them block layout.
  const occupied = new Map([...items].filter(([, v]) => v.type !== "arrow").map(([k, v]) => [k, v.bbox]));
  const region = /^region:(\d+),(\d+),(\d+),(\d+)$/.exec(op.place);
  const size = op.op === "draw_shape" && region ? { w: +region[3], h: +region[4] } : naturalSize(op, (l) => toBoard({ x: 0, y: 0, ...measureMath(l) }));
  const groupPrev = op.group && [...page].reverse().find((s) => s.meta.group === op.group && !s.meta.part && boardIdOf(s) !== id);
  const box = resolvePlace(op.place, size, occupied, groupPrev ? occupied.get(boardIdOf(groupPrev)) : undefined);
  if (op.op === "place_image") {
    if (editor.getAsset(imageAssetId(id))) editor.deleteAssets([imageAssetId(id)]);
    editor.createAssets([imageAsset(id, op.url, box, S)]);
  }
  editor.createShapes(opToShapePartials({ ...op, id }, box, S));
  penShow(editor, fx, id);
  return id;
}

const scaled = (b: Box): Box => ({ x: b.x * S, y: b.y * S, w: b.w * S, h: b.h * S });

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
      editor.run(() => { id = applyOne(editor, fxFor(editor), v.op); }, { history: "ignore" }); // tutor ops stay off the student's undo stack
      if (id) ids.push(id);
    } catch (e) {
      errors.push(`op ${i}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return { ok: errors.length === 0, ids, errors };
}

type Props = {
  onCircle?: (e: CircleEvent) => void;
  className?: string;
  /** Extensions mounted with the editor (read once, at mount). */
  plugins?: BoardPlugin[];
  emit?: (topic: string, payload: unknown) => void;
};

/** Shared tldraw board: the tutor writes via `applyOps`; the student draws freely and can circle a region to ask about it. */
export const Whiteboard = forwardRef<BoardHandle, Props>(function Whiteboard({ onCircle, className, plugins = [], emit }, ref) {
  const editorRef = useRef<Editor | null>(null);
  const circling = useRef<{ prevColor: TLDefaultColorStyle } | null>(null);
  const onCircleRef = useRef(onCircle);
  onCircleRef.current = onCircle;
  const emitRef = useRef(emit);
  emitRef.current = emit;

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
    const fx = fxFor(editor);
    // Fit the page width, then go back to what the camera was following (if anything).
    const fit = () => fitBoardCamera(editor) && fx.refollow();
    fit();
    // Re-fit when the container resizes (side panels open/close) — this also does the first fit if the
    // viewport had no size yet at mount.
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
    const offPlugins = plugins.map((plugin) => plugin({
      editor,
      emit: (topic, payload) => emitRef.current?.(topic, payload),
      snapshot: (region) => snapshot(editor, region),
      describe: () => describe(editor),
    }));
    return () => { offAuthor(); offLasso(); offPlugins.forEach((off) => off?.()); ro.disconnect(); disposeFx(editor); editorRef.current = null; };
  };

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }} role="region" aria-label="Shared whiteboard">
      <Tldraw shapeUtils={shapeUtils} components={components} onMount={onMount} getShapeVisibility={hideUnrevealed} />
    </div>
  );
});
