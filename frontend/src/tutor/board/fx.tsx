"use client";

import { PenLine } from "lucide-react";
import { atom, b64Vecs, EASINGS, useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import type { Box } from "../contracts/types";
import { cameraFor, followPaused } from "./camera";
import { schedule, writeKeyframes } from "./pen";

type Tip = { key: string; box: Box; lines: number; ms: number };
type Laser = { x: number; y: number };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const HIDDEN = "clip-path: polygon(0 0, 0 0, 0 0)";
const FOLLOW_MS = 650;

/**
 * Per-board effects that are not stored on the board: pen writing reveal, stroke drawing, the laser dot and the camera
 * following the pen. Page units throughout (BOARD_SCALE is 1).
 */
export class BoardFx {
  readonly tips = atom<Tip[]>("pen tips", []);
  readonly laser = atom<Laser | null>("laser", null);
  private penFreeAt = 0;
  private lastUserAt: number | undefined;
  private rules = new Map<string, string>(); // shape id → CSS declaration while it is being written
  private pending = new Map<string, string>(); // shape id → token of the write that owns it
  private lastFrame: [Box, Box] | undefined;
  private frames = new Set<number>(); // n-line keyframes already in the sheet
  private keyframes = "";
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private style = document.head.appendChild(document.createElement("style"));
  private offEvent: () => void;

  constructor(private editor: Editor) {
    // The student's own pan/zoom/drawing pauses following, so the camera never fights them.
    const onEvent = (e: { type: string; name?: string }) => {
      if (e.type === "wheel" || e.type === "pinch" || e.type === "keyboard" || (e.type === "pointer" && (e.name === "pointer_down" || editor.inputs.getIsPointing())))
        this.lastUserAt = Date.now();
    };
    editor.on("event", onEvent);
    this.offEvent = () => editor.off("event", onEvent);
  }

  dispose() {
    this.offEvent();
    this.timers.forEach(clearTimeout);
    this.style.remove();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  private setRule(id: TLShapeId, decl: string | undefined) {
    if (decl) this.rules.set(id, decl); else this.rules.delete(id);
    this.style.textContent = this.keyframes + [...this.rules].map(([k, v]) => `.tl-shape[data-shape-id="${k}"]{${v}}`).join("\n");
  }

  private hide(id: TLShapeId) {
    const token = `${Math.random()}`;
    this.pending.set(id, token);
    this.setRule(id, HIDDEN);
    return () => this.pending.get(id) === token; // still ours (not rewritten or erased meanwhile)?
  }

  private ensureFrames(n: number) {
    if (this.frames.has(n)) return;
    this.frames.add(n);
    const { clip, tip } = writeKeyframes(n);
    this.keyframes += `@keyframes tw-clip-${n}{${clip}}\n@keyframes tw-tip-${n}{${tip}}\n`;
  }

  /** Queue `ms` of pen work; `start` runs when the pen gets to it. Returns the delay. */
  private queue(ms: number, start: () => void): number {
    const { delay, freeAt } = schedule(Date.now(), this.penFreeAt, ms);
    this.penFreeAt = freeAt;
    if (delay) this.later(delay, start); else start();
    return delay;
  }

  /**
   * Write an existing text/math shape as if by hand: hidden now, revealed row by row behind a pen tip when the pen
   * gets to it. Call before the shape first renders. `onStart` runs as the pen starts (the camera follows it there).
   */
  write(id: TLShapeId, box: Box, lines: number, ms: number, onStart?: () => void) {
    if (reducedMotion()) return this.queue(0, () => onStart?.());
    this.ensureFrames(lines);
    const mine = this.hide(id);
    const key = `${id}:${Math.random()}`;
    this.queue(ms, () => {
      if (!mine()) return;
      this.setRule(id, `animation: tw-clip-${lines} ${ms}ms linear both`);
      this.tips.update((t) => [...t, { key, box, lines, ms }]);
      onStart?.();
      this.later(ms + 50, () => {
        if (mine()) this.cancel(id);
        this.tips.update((t) => t.filter((x) => x.key !== key));
      });
    });
  }

  /** Non-written items (plots, shapes, images, arrows) appear when the pen gets to them, not before earlier writing. */
  appear(ids: TLShapeId[], onStart?: () => void) {
    if (reducedMotion()) return this.queue(0, () => onStart?.());
    const mine = ids.map((id) => this.hide(id));
    this.queue(300, () => {
      ids.forEach((id, i) => mine[i]() && this.setRule(id, "animation: tw-fade 300ms ease-out both"));
      onStart?.();
      this.later(350, () => ids.forEach((id, i) => mine[i]() && this.cancel(id)));
    });
  }

  /** Run after the pen has finished what is already queued (point at / focus on what was just written). */
  after(fn: () => void) {
    this.queue(0, fn);
  }

  /** Forget any pending writing for a shape that is being replaced or erased. */
  cancel(id: TLShapeId) {
    this.pending.delete(id);
    if (this.rules.has(id)) this.setRule(id, undefined);
  }

  /** Draw freehand strokes (page units) point by point into existing draw shapes, one pen stroke after another. */
  stroke(shapes: { id: TLShapeId; x: number; y: number; points: { x: number; y: number }[] }[], onStart?: () => void) {
    const editor = this.editor;
    const set = (id: TLShapeId, pts: { x: number; y: number }[]) => {
      if (!editor.getShape(id)) return false;
      const path = b64Vecs.encodePoints(pts.map((p) => ({ ...p, z: 0.5 })));
      editor.run(() => editor.updateShape({ id, type: "draw", props: { segments: [{ type: "free", path }], isComplete: false } }), { history: "ignore" });
      return true;
    };
    if (reducedMotion()) return this.queue(0, () => onStart?.());
    const msOf = (pts: { x: number; y: number }[]) =>
      Math.max(500, Math.min(1500, pts.reduce((d, p, i) => d + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0) * 1.6));
    const mine = shapes.map((s) => this.hide(s.id));
    shapes.forEach((s, i) => {
      const ms = msOf(s.points), local = s.points.map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
      this.queue(ms, () => {
        if (!mine[i]()) return;
        if (i === 0) onStart?.();
        this.cancel(s.id);
        if (!set(s.id, local.slice(0, 2))) return;
        const t0 = performance.now();
        const tick = () => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          const n = Math.max(2, Math.ceil(k * local.length));
          if (!set(s.id, local.slice(0, n))) return;
          if (k < 1) requestAnimationFrame(tick);
          else editor.run(() => editor.updateShape({ id: s.id, type: "draw", props: { isComplete: true } }), { history: "ignore" });
        };
        requestAnimationFrame(tick);
      });
    });
  }

  /** Smoothly frame `region` (page units), keeping `anchor` fully visible. Skipped while the student is moving around. */
  follow(region: Box, anchor: Box = region, { force = false } = {}) {
    if (!force && followPaused(this.lastUserAt, Date.now())) return;
    const cam = cameraFor(this.editor.getViewportScreenBounds(), region, anchor);
    if (!cam) return;
    this.lastFrame = [region, anchor];
    this.editor.setCamera(cam, { animation: { duration: FOLLOW_MS, easing: EASINGS.easeInOutCubic } });
  }

  /** After a resize: frame the last followed region again (instantly). False if nothing was followed yet. */
  refollow(): boolean {
    const cam = this.lastFrame && cameraFor(this.editor.getViewportScreenBounds(), ...this.lastFrame);
    if (cam) this.editor.setCamera(cam);
    return !!cam;
  }

  /** Laser dot at a page point; it never fades, it stays parked there until the next point. */
  point(x: number, y: number) {
    this.laser.set({ x, y });
  }
}

const fxByEditor = new WeakMap<Editor, BoardFx>();
export const fxFor = (editor: Editor) => {
  let fx = fxByEditor.get(editor);
  if (!fx) fxByEditor.set(editor, (fx = new BoardFx(editor)));
  return fx;
};
export const disposeFx = (editor: Editor) => {
  fxByEditor.get(editor)?.dispose();
  fxByEditor.delete(editor);
};

const CSS = `
.tw-tip { position: absolute; width: 30px; height: 30px; margin: -26px 0 0 -3px; opacity: 0; color: #334155;
  filter: drop-shadow(0 2px 2px rgba(15,23,42,.25)); pointer-events: none; }
.tw-laser { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none;
  transition: transform 700ms cubic-bezier(.2,.8,.2,1); }
.tw-laser > i { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%;
  background: radial-gradient(circle, #ff3b30 0 45%, rgba(255,59,48,.35) 60%, rgba(255,59,48,0) 72%);
  animation: tw-pulse 1.1s ease-in-out infinite; }
.tw-ask { position: absolute; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; background: #7c3aed;
  color: #fff; font: 700 15px/24px system-ui, sans-serif; text-align: center; box-shadow: 0 1px 4px rgba(15,23,42,.3); }
@keyframes tw-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes tw-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.45) } }
@media (prefers-reduced-motion: reduce) { .tw-tip { display: none } .tw-laser { transition: none } .tw-laser > i { animation: none } }
`;

/** Rendered by tldraw inside the camera-transformed layer (`OnTheCanvas`), so positions are page units. */
export function BoardFxLayer() {
  const editor = useEditor();
  const fx = fxFor(editor);
  const tips = useValue("pen tips", () => fx.tips.get(), [fx]);
  const laser = useValue("laser", () => fx.laser.get(), [fx]);
  // The student's open questions: a "?" on each persistent Circle-to-Ask mark.
  const circles = useValue("circles", () => editor.getCurrentPageShapes().flatMap((s) => {
    const b = s.meta.circle_id ? editor.getShapePageBounds(s) : undefined;
    return b ? [{ id: s.id, x: b.maxX, y: b.y }] : [];
  }), [editor]);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, zIndex: 100000, pointerEvents: "none" }} aria-hidden>
      <style>{CSS}</style>
      {tips.map((t) => (
        <div key={t.key} style={{ position: "absolute", left: t.box.x, top: t.box.y, width: t.box.w, height: t.box.h }}>
          <PenLine className="tw-tip" style={{ animation: `tw-tip-${t.lines} ${t.ms}ms linear forwards` }} />
        </div>
      ))}
      {circles.map((c) => <span key={c.id} className="tw-ask" style={{ left: c.x, top: c.y }}>?</span>)}
      {laser && <div className="tw-laser" style={{ transform: `translate(${laser.x}px, ${laser.y}px)` }}><i /></div>}
    </div>
  );
}
