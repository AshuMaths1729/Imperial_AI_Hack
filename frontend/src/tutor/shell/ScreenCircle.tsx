"use client";

import { useRef, useState, type PointerEvent } from "react";
import { downscaleDims, type Box, type CircleEvent } from "@/tutor/board";

type Size = { w: number; h: number };

/** Element-px region → intrinsic video px, for an `object-fit: contain` video (letterbox bars are clamped away). */
export function toIntrinsic(region: Box, element: Size, video: Size): Box {
  const s = Math.min(element.w / video.w, element.h / video.h);
  const ox = (element.w - video.w * s) / 2;
  const oy = (element.h - video.h * s) / 2;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x0 = clamp((region.x - ox) / s, video.w);
  const y0 = clamp((region.y - oy) / s, video.h);
  const x1 = clamp((region.x + region.w - ox) / s, video.w);
  const y1 = clamp((region.y + region.h - oy) / s, video.h);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** PNG (base64, no data: prefix) of `region` (element px) cut from the current frame at full resolution, long side ≤ 1024. */
export function cropVideoFrame(video: HTMLVideoElement, region: Box): string {
  const src = toIntrinsic(region, { w: video.clientWidth, h: video.clientHeight }, { w: video.videoWidth, h: video.videoHeight });
  const out = downscaleDims(Math.max(1, src.w), Math.max(1, src.h));
  const canvas = document.createElement("canvas");
  canvas.width = out.w;
  canvas.height = out.h;
  canvas.getContext("2d")!.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, out.w, out.h);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Lasso overlay on the shared screen. Emits the crop plus the region in 0–1000 units of the shared frame. */
export function ScreenCircle({ video, onCircle }: { video: HTMLVideoElement | null; onCircle: (e: CircleEvent) => void }) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const drawing = useRef(false);

  const at = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const finish = () => {
    drawing.current = false;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    setPoints([]);
    if (!video || !video.videoWidth || xs.length < 2) return;
    const region = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (region.w < 8 || region.h < 8) return; // a click, not a circle
    const src = toIntrinsic(region, { w: video.clientWidth, h: video.clientHeight }, { w: video.videoWidth, h: video.videoHeight });
    if (!src.w || !src.h) return; // drawn entirely on the letterbox bars
    const k = 1000;
    onCircle({
      png_b64: cropVideoFrame(video, region),
      region: {
        x: Math.round((src.x / video.videoWidth) * k),
        y: Math.round((src.y / video.videoHeight) * k),
        w: Math.round((src.w / video.videoWidth) * k),
        h: Math.round((src.h / video.videoHeight) * k),
      },
      item_ids: [],
      source: "screen",
    });
  };

  return (
    <div
      aria-label="Circle part of your shared screen to ask about it"
      className="absolute inset-0 z-20 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        setPoints([at(e)]);
      }}
      onPointerMove={(e) => {
        if (drawing.current) {
          const p = at(e);
          setPoints((ps) => [...ps, p]);
        }
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        drawing.current = false;
        setPoints([]);
      }}
    >
      <p className="apple-glass-elevated pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium text-[var(--text-primary)]">
        Circle what you want to ask about
      </p>
      {points.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <polyline
            points={points.map((p) => p.join(",")).join(" ")}
            style={{ fill: "color-mix(in srgb, var(--accent) 8%, transparent)", stroke: "var(--accent)" }}
            strokeWidth={2.5}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
}
