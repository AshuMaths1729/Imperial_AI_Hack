"use client";

import React, { useRef, useState, useEffect } from "react";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LassoOverlayProps {
  active: boolean;
  onCapture: (bbox: BoundingBox) => void;
}

export function LassoOverlay({ active, onCapture }: LassoOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);

  // The canvas only mounts while active, so size it whenever it (re)appears.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  };

  if (!active) return null;

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    clearCanvas();
    const p = getPos(e);
    pointsRef.current = [p];
    setDrawing(true);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const p = getPos(e);
    const pts = pointsRef.current;
    pts.push(p);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    // Canvas can't read CSS vars directly: resolve the theme's accent so the lasso matches every theme.
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#0066cc";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();
  };

  const handleUp = () => {
    if (!drawing) return;
    setDrawing(false);
    const pts = pointsRef.current;
    if (pts.length < 3) {
      clearCanvas();
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    onCapture({
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.max(24, Math.round(maxX - minX)),
      h: Math.max(24, Math.round(maxY - minY)),
    });
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      className="absolute inset-0 z-20 cursor-crosshair"
    />
  );
}
