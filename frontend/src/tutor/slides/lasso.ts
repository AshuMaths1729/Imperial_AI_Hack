// Marks on a slide: what a student's circle encloses (and a PNG of it for the tutor), and where the laser sits.
import type { Box } from "@/tutor/contracts/types";
import { CANVAS } from "./scene";

type Pt = { x: number; y: number };

/** Where the laser parks when a slide opens: just left of the title (which starts at x=80, y=44). */
export const LASER_PARK = { x: 54, y: 74 };

/** Laser spot for an object's box: just under text and formulas (like an underline), else its centre. */
export const laserSpot = (b: Box, isText: boolean) => ({ x: b.x + b.w / 2, y: isText ? b.y + b.h + 14 : b.y + b.h / 2 });

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function bboxOf(pts: Pt[]): Box {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Objects whose centre the loop encloses; if none, those overlapping the loop's box (a loose circle still counts). */
export function hitItems(poly: Pt[], boxes: { id: string; box: Box }[]): string[] {
  const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const inside = boxes.filter((b) => pointInPolygon(centre(b.box), poly)).map((b) => b.id);
  if (inside.length) return inside;
  const r = bboxOf(poly);
  return boxes
    .filter(({ box: b }) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h)
    .map((b) => b.id);
}

/** Boxes (canvas units) of the visible objects inside a SlideView root. */
export function objectBoxes(root: HTMLElement): { id: string; box: Box }[] {
  const r = root.getBoundingClientRect();
  const k = r.width / CANVAS.w || 1;
  return [...root.querySelectorAll<HTMLElement>("[data-obj]")]
    .filter((el) => getComputedStyle(el).opacity !== "0")
    .map((el) => {
      const b = el.getBoundingClientRect();
      return { id: el.dataset.obj!, box: { x: (b.left - r.left) / k, y: (b.top - r.top) / k, w: b.width / k, h: b.height / k } };
    })
    .filter((b) => b.box.w > 0 || b.box.h > 0);
}

/**
 * PNG (base64) of a region of the slide, long side <= maxSide. The SVG layer is rasterised as is; KaTeX and
 * text are redrawn as plain text (an SVG image can't use the page's fonts and styles), which is enough for
 * the tutor to see what was circled.
 */
export async function slidePng(root: HTMLElement, region: Box, maxSide = 640): Promise<string> {
  const pad = 24;
  const rg = { x: Math.max(0, region.x - pad), y: Math.max(0, region.y - pad), w: region.w + 2 * pad, h: region.h + 2 * pad };
  const k = Math.min(1.5, maxSide / Math.max(rg.w, rg.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rg.w * k));
  canvas.height = Math.max(1, Math.round(rg.h * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, -rg.x * k, -rg.y * k);

  const svg = root.querySelector("svg");
  if (svg) {
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await img.decode();
    ctx.drawImage(img, 0, 0, CANVAS.w, CANVAS.h);
  }
  const r = root.getBoundingClientRect();
  const s = r.width / CANVAS.w || 1;
  ctx.textBaseline = "middle";
  for (const el of root.querySelectorAll<HTMLElement>("[data-title], div[data-obj]")) {
    if (getComputedStyle(el).opacity === "0") continue;
    const b = el.getBoundingClientRect();
    const text = (el.querySelector(".katex-html") ?? el).textContent?.trim();
    if (!text) continue;
    const span = el.querySelector<HTMLElement>("[data-inner] > *");
    const size = parseFloat(span?.style.fontSize || "32");
    ctx.font = `${size}px serif`;
    ctx.fillStyle = span?.style.color || "#ECECEC";
    ctx.fillText(text, (b.left - r.left) / s, (b.top - r.top + b.height / 2) / s, b.width / s + 40);
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}
