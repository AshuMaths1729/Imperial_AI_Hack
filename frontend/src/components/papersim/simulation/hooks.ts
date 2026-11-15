"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ---------------- prefers-reduced-motion ---------------- */

const RM_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(RM_QUERY).matches : false),
    () => false
  );
}

/* ---------------- element width ---------------- */

/** Callback ref + measured content width (ResizeObserver). */
export function useElementWidth<T extends HTMLElement>(initial = 760) {
  const [width, setWidth] = useState(initial);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(node);
    observerRef.current = ro;
  }, []);
  return [ref, width] as const;
}

/* ---------------- dismissable popover ---------------- */

/** Open state for a click-toggled popover that closes on outside click / Escape. */
export function usePopover<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/* ---------------- tweened chart frame ---------------- */

export interface Frame {
  /** Shared x samples. */
  x: number[];
  /** One y array per series (same order as the simulation). */
  ys: number[][];
  /** Domain; y is in scale space (log10 when `log`). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  log: boolean;
}

function compatible(a: Frame, b: Frame): boolean {
  return (
    a.log === b.log &&
    a.x.length === b.x.length &&
    a.ys.length === b.ys.length &&
    a.ys.every((y, i) => y.length === b.ys[i].length)
  );
}

const lerp = (a: number, b: number, t: number) =>
  Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : b;

function mix(a: Frame, b: Frame, t: number): Frame {
  return {
    x: b.x.map((v, i) => lerp(a.x[i], v, t)),
    ys: b.ys.map((ys, s) => ys.map((v, i) => lerp(a.ys[s][i], v, t))),
    x0: lerp(a.x0, b.x0, t),
    x1: lerp(a.x1, b.x1, t),
    y0: lerp(a.y0, b.y0, t),
    y1: lerp(a.y1, b.y1, t),
    log: b.log,
  };
}

/**
 * Smoothly morphs the chart from the frame on screen to `target` (ease-out, rAF).
 * Disabled (reduced motion) it returns `target` directly. `target` must be memoised.
 */
export function useTweenedFrame(target: Frame, enabled: boolean, duration = 280): Frame {
  const [shown, setShown] = useState<Frame>(target);
  const shownRef = useRef<Frame>(target);

  useEffect(() => {
    if (!enabled) return;
    const from = shownRef.current;
    let raf = 0;
    if (from === target) return;
    if (!compatible(from, target)) {
      raf = requestAnimationFrame(() => {
        shownRef.current = target;
        setShown(target);
      });
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const f = t >= 1 ? target : mix(from, target, eased);
      shownRef.current = f;
      setShown(f);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);

  return enabled ? shown : target;
}
