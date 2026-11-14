import type { Editor } from "tldraw";
import type { Box } from "../contracts/types";
import { BOARD_H, BOARD_W } from "./layout";

export type CameraEditor = Pick<
  Editor,
  "getContainer" | "updateViewportScreenBounds" | "setCameraOptions" | "getCamera" | "setCamera"
> & { getViewportScreenBounds(): { w: number; h: number } };

/** Screen px kept clear around the page: tldraw's top bar and bottom toolbar sit over the canvas. */
export const INSETS = { top: 56, right: 16, bottom: 72, left: 16 };
// Below this the padded fit zoom goes to ≤0 and tldraw computes an Infinity camera, which crashes the editor.
const MIN_VIEWPORT = INSETS.top + INSETS.bottom;
/** Following never zooms past this (a short label would otherwise fill a big screen). */
export const MAX_ZOOM = 1.35;
/** Following frames at least this much page width, so a short line keeps some context. */
const MIN_FRAME_W = 600;
const PAD = 20; // page units around the framed region
export const FOLLOW_PAUSE_MS = 6000;

/**
 * Fit the page width and show its top. Returns false (and changes nothing) while the viewport is too small to fit
 * into — e.g. before layout settles or when a squeezed layout gives the board ~1px. Call again on resize.
 */
export function fitBoardCamera(editor: CameraEditor): boolean {
  editor.updateViewportScreenBounds(editor.getContainer());
  if (!usable(editor.getViewportScreenBounds())) return false;
  editor.setCameraOptions({
    constraints: {
      bounds: { x: 0, y: 0, w: BOARD_W, h: BOARD_H }, padding: { x: INSETS.left, y: INSETS.top }, origin: { x: 0.5, y: 0 },
      initialZoom: "fit-x", baseZoom: "fit-x", behavior: "contain",
    },
  });
  editor.setCamera(editor.getCamera(), { reset: true });
  return true;
}

const usable = ({ w, h }: { w: number; h: number }) => w > MIN_VIEWPORT && h > MIN_VIEWPORT;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * tldraw camera (screen = (page + camera) · z) that frames `region` (page units) in the clear area of the viewport.
 * Zoom comes from the region's width (readable, never past the page width or MAX_ZOOM); `anchor` (default: the region)
 * must fit in height. A region taller than the screen is scrolled so the anchor — the newest line — sits at the bottom.
 * Null while the viewport is too small to frame anything (the same crash guard as fitBoardCamera).
 */
export function cameraFor(viewport: { w: number; h: number }, region: Box, anchor: Box = region): { x: number; y: number; z: number } | null {
  if (!usable(viewport)) return null;
  const availW = viewport.w - INSETS.left - INSETS.right;
  const availH = viewport.h - INSETS.top - INSETS.bottom;
  const frameW = clamp(region.w + 2 * PAD, MIN_FRAME_W, BOARD_W);
  const z = Math.min(MAX_ZOOM, availW / frameW, availH / (anchor.h + 2 * PAD));
  const viewW = availW / z, viewH = availH / z;

  const left = clamp(region.x + region.w / 2 - viewW / 2, 0, Math.max(0, BOARD_W - viewW));
  const top = (region.h + 2 * PAD) * z <= availH
    ? region.y + region.h / 2 - viewH / 2
    : anchor.y + anchor.h + PAD - viewH;
  const topClamped = clamp(top, 0, Math.max(0, BOARD_H - viewH));
  return { x: INSETS.left / z - left, y: INSETS.top / z - topClamped, z };
}

/** True while the student's recent pan/zoom/drawing should keep the camera still. */
export const followPaused = (lastUserInputAt: number | undefined, now: number) =>
  lastUserInputAt !== undefined && now - lastUserInputAt < FOLLOW_PAUSE_MS;
