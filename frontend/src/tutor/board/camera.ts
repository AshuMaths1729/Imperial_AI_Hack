import type { Editor } from "tldraw";

export type CameraEditor = Pick<
  Editor,
  "getContainer" | "updateViewportScreenBounds" | "setCameraOptions" | "getCamera" | "setCamera"
> & { getViewportScreenBounds(): { w: number; h: number } };

const PADDING = 16;
// Below this the padded "fit-max" zoom goes to ≤0 and tldraw computes an Infinity camera, which crashes the editor.
const MIN_VIEWPORT = 4 * PADDING;

/**
 * Fit the whole board in view. Returns false (and changes nothing) while the viewport is too small to fit
 * into — e.g. before layout settles or when a squeezed layout gives the board ~1px. Call again on resize.
 */
export function fitBoardCamera(editor: CameraEditor, boardSize: number): boolean {
  editor.updateViewportScreenBounds(editor.getContainer());
  const { w, h } = editor.getViewportScreenBounds();
  if (!(w > MIN_VIEWPORT && h > MIN_VIEWPORT)) return false;
  editor.setCameraOptions({
    constraints: {
      bounds: { x: 0, y: 0, w: boardSize, h: boardSize }, padding: { x: PADDING, y: PADDING }, origin: { x: 0.5, y: 0.5 },
      initialZoom: "fit-max", baseZoom: "fit-max", behavior: "contain",
    },
  });
  editor.setCamera(editor.getCamera(), { reset: true });
  return true;
}
