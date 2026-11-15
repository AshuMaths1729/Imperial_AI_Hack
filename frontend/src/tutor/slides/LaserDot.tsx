"use client";

// The red laser dot on a 1600x900 slide canvas (the main slide and the explanation pop-up each have one).
// point(id) aims it: lines, curves, arrows and axes are traced along; dots, text and formulas are glided to. The
// pointed object glows for a moment so the eye knows exactly what is meant. Reduced motion: it just jumps.
import { useLayoutEffect, useRef } from "react";
import { insideRun, LASER_PARK, laserFrames, laserSpot, TRACE } from "./lasso";
import { CANVAS } from "./scene";

const LASER_PX = 12; // dot diameter on screen
const GLOW_MS = 1500;

type Pt = { x: number; y: number };
/** Where the laser should go: an object (`kind` picks trace vs glide, `color` tints its glow), or parked (id null). */
export type Aim = { id: string | null; kind?: string; color?: string; nonce: number };

/** Evenly spaced points along the object's drawn line(s), in canvas units; [] when it isn't traceable here. */
function tracePoints(node: Element, kind: string): Pt[] {
  const sel = TRACE[kind as keyof typeof TRACE];
  if (!sel) return [];
  const parts = [...node.querySelectorAll<SVGGeometryElement>(sel)].filter((e) => typeof e.getTotalLength === "function");
  const sample = (e: SVGGeometryElement, n = 48) => {
    const len = e.getTotalLength();
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = e.getPointAtLength((len * i) / n);
      return { x: p.x, y: p.y };
    });
  };
  // axes: down the y axis, then along the x axis (they meet at the corner)
  if (kind === "axes" && parts.length === 2) return [...sample(parts[1]).reverse(), ...sample(parts[0])];
  const pts = parts.flatMap((e) => sample(e));
  // a curve is clipped to its axes: trace only the part that is drawn
  const clip = parts[0]?.getAttribute("clip-path")?.match(/url\(#(.+)\)/)?.[1];
  const rect = clip ? node.ownerDocument.getElementById(clip)?.querySelector("rect") : null;
  if (!rect) return pts;
  const n = (a: string) => Number(rect.getAttribute(a));
  return insideRun(pts, { x: n("x"), y: n("y"), w: n("width"), h: n("height") });
}

function currentPos(el: HTMLElement | null): Pt | null {
  if (!el || typeof getComputedStyle !== "function") return null;
  const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  const v = m[1].split(",").map(Number);
  return { x: v[4], y: v[5] };
}

type Props = {
  aim: Aim;
  /** The SlideView root this laser points into. */
  root: () => HTMLElement | null;
  /** The canvas scale (keeps the dot ~12 px on screen). */
  k: number;
  reduced: boolean;
  /** Hidden while the other laser (main slide / pop-up) is the active one. */
  hidden?: boolean;
  testId: string;
};

export function LaserDot({ aim, root, k, reduced, hidden, testId }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const posRef = useRef<Pt>(LASER_PARK); // where the dot rests (its transform is set here, not by React state)
  const glow = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const dot = el.current;
    let to: Pt = LASER_PARK;
    let path: Pt[] = [];
    if (aim.id) {
      const r = root();
      const node = r?.querySelector<HTMLElement>(`[data-obj="${aim.id}"]`);
      if (!r || !node) return;
      const rb = r.getBoundingClientRect(), b = node.getBoundingClientRect();
      const s = rb.width / CANVAS.w || 1;
      if (!b.width && !b.height) return;
      // text and formulas: sit just under them (like an underline) instead of covering the words
      to = laserSpot({ x: (b.left - rb.left) / s, y: (b.top - rb.top) / s, w: b.width / s, h: b.height / s }, node.tagName === "DIV");
      if (!reduced && aim.kind) path = tracePoints(node, aim.kind);
      if (path.length > 1) to = path[path.length - 1];
      if (to.x < 0 || to.y < 0 || to.x > CANVAS.w || to.y > CANVAS.h) return; // nothing drawn on the canvas to point at
      if (!reduced && typeof node.animate === "function") {
        glow.current?.cancel();
        const g = `drop-shadow(0 0 6px ${aim.color ?? "#fff"}) drop-shadow(0 0 14px ${aim.color ?? "#fff"}) brightness(1.35)`;
        glow.current = node.animate(
          [{ filter: "none" }, { filter: g, offset: 0.2 }, { filter: g, offset: 0.75 }, { filter: "none" }],
          { duration: GLOW_MS, easing: "ease-in-out" }
        );
      }
    }
    // start from wherever the dot is on screen right now (possibly mid-glide)
    const from = currentPos(dot) ?? posRef.current;
    if (dot && !reduced && typeof dot.animate === "function") {
      dot.getAnimations().forEach((a) => a.cancel());
      const { frames, ms } = laserFrames(from, path.length > 1 ? path : [to]);
      if (ms) dot.animate(frames, { duration: ms });
    }
    posRef.current = to;
    if (dot) dot.style.transform = `translate(${to.x}px, ${to.y}px)`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-aim only when asked to point again
  }, [aim.nonce]);

  return (
    <div
      ref={el}
      data-testid={testId}
      aria-hidden
      className="pointer-events-none absolute left-0 top-0"
      style={{ transform: `translate(${LASER_PARK.x}px, ${LASER_PARK.y}px)`, opacity: hidden ? 0 : 1 }}
    >
      {/* one small solid dot with a soft glow, ~12 px on screen whatever the canvas scale; no ring */}
      <span className="absolute left-0 top-0 rounded-full" style={{ width: LASER_PX / k, height: LASER_PX / k, transform: "translate(-50%,-50%)", background: "#ff3131", boxShadow: `0 0 ${10 / k}px ${3 / k}px rgba(255,49,49,.45)` }} />
    </div>
  );
}
