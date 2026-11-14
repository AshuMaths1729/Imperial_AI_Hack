import type { TLShape } from "tldraw";
import type { BoardDescription, BoardItem, Box } from "../contracts/types";

export type { BoardDescription, BoardItem } from "../contracts/types";

const MAX = 120;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

type RichNode = { type?: string; text?: string; content?: RichNode[] };
const plain = (n: unknown): string => {
  const node = n as RichNode | undefined;
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(plain).join(node.type === "doc" ? "\n" : "");
};

/** Board id: tutor shapes carry it in meta; user shapes use their tldraw id without "shape:". */
export const boardIdOf = (s: TLShape) => (typeof s.meta.boardId === "string" ? s.meta.boardId : s.id.slice("shape:".length));

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * Compact text view of the board for the tutor: one item per board id (parts merged),
 * user freehand reported as "ink", strings clipped to 120 chars. Highlight overlays are not items.
 */
export function describeShapes(shapes: TLShape[], toBoardUnits: (s: TLShape) => Box | undefined): BoardDescription {
  const items = new Map<string, BoardItem>();
  for (const s of shapes) {
    if (s.meta.part === "highlight") continue;
    const bbox = toBoardUnits(s);
    if (!bbox) continue;
    const id = boardIdOf(s);
    const p = s.props as { richText?: unknown; latex?: string; label?: string; altText?: string };
    const words = clip(plain(p.richText).trim());

    let item = items.get(id);
    if (!item) {
      const tutor = s.meta.author === "tutor";
      const type = tutor ? String(s.meta.kind ?? s.type) : s.type === "draw" || s.type === "highlight" ? "ink" : s.type;
      item = { id, type, author: tutor ? "tutor" : "user", bbox };
      items.set(id, item);
    } else item.bbox = union(item.bbox, bbox);

    if (s.meta.part === "caption") { if (words) item.label = words; continue; }
    if (p.latex) item.latex = clip(p.latex);
    if (s.type === "text" && words) item.text = words;
    else if (words || p.label || p.altText) item.label ??= words || clip(p.label || p.altText || "");
  }
  return { items: [...items.values()] };
}
