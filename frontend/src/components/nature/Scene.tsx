"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "../ThemeProvider";
import { drawMotes, makeMotes, paintScene, type SceneKind } from "./paint";

export type { SceneKind } from "./paint";

type SceneState = { kind: SceneKind; calm: boolean };
const SceneCtx = createContext<((kind: SceneKind, calm: boolean) => void) | null>(null);

/**
 * Picks the landscape behind the current screen. Call it once at the top of a screen:
 * Home and Live Lessons use "meadow", Paper Simulator "hills", Evidence Map "lake".
 * `calm` starts the fade into the paper ground higher, for screens dense with panels.
 */
export function useScene(kind: SceneKind, calm = true) {
  const set = useContext(SceneCtx);
  useEffect(() => {
    set?.(kind, calm);
  }, [set, kind, calm]);
}

/** Wraps the app once (layout.tsx): the landscape behind everything. */
export function SceneProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SceneState>({ kind: "meadow", calm: false });
  const set = useCallback(
    (kind: SceneKind, calm: boolean) => setState((s) => (s.kind === kind && s.calm === calm ? s : { kind, calm })),
    []
  );
  return (
    <SceneCtx.Provider value={set}>
      <Scene kind={state.kind} calm={state.calm} />
      {children}
    </SceneCtx.Provider>
  );
}

function Scene({ kind, calm }: SceneState) {
  const { theme } = useTheme();
  const far = useRef<HTMLCanvasElement>(null);
  const bokeh = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const motes = useRef<HTMLCanvasElement>(null);
  const dark = theme === "dark";
  const off = theme === "contrast";

  useEffect(() => {
    if (off) return;
    const [f, b, fr, pollen] = [far.current, bokeh.current, front.current, motes.current];
    if (!f || !b || !fr || !pollen) return;
    const layers = { far: f, bokeh: b, front: fr };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let dots = makeMotes(window.innerWidth, window.innerHeight);

    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      paintScene(kind, dark, layers, window.innerWidth + 80, window.innerHeight + 80, dpr);
      pollen.width = Math.round(window.innerWidth * dpr);
      pollen.height = Math.round(window.innerHeight * dpr);
      pollen.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = makeMotes(window.innerWidth, window.innerHeight);
      drawMotes(pollen, dots, window.innerWidth, window.innerHeight, 0, dark);
    };
    const loop = (t: number) => {
      if (!document.hidden) drawMotes(pollen, dots, window.innerWidth, window.innerHeight, t, dark);
      raf = requestAnimationFrame(loop);
    };
    let resize = 0;
    const onResize = () => {
      window.clearTimeout(resize);
      resize = window.setTimeout(paint, 120);
    };

    paint();
    if (!reduceMotion) raf = requestAnimationFrame(loop);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resize);
      window.removeEventListener("resize", onResize);
    };
  }, [kind, dark, off]);

  if (off) return null;
  return (
    <div className="st-scene" data-scene={kind} data-calm={calm} aria-hidden>
      {/* Depth of field: far layer slightly soft, blossoms very soft, foreground grass soft. */}
      <canvas ref={far} style={{ filter: "blur(3px)" }} />
      <canvas ref={bokeh} style={{ filter: "blur(16px)", opacity: 0.95 }} />
      <canvas ref={front} style={{ filter: "blur(5px)" }} />
      <canvas ref={motes} data-layer="motes" />
    </div>
  );
}
