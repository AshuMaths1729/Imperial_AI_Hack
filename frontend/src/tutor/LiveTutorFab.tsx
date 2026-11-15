"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GraduationCap, X } from "lucide-react";
import { LiveAvatarTile, type AvatarCall } from "./LiveAvatarTile";
import { useAvatarCall } from "./useAvatarCall";
import { listTutors, type Tutor } from "./api";

type Props = {
  /** Reuse a call the page already owns (the lecture workspace's ask box talks into it). */
  call?: AvatarCall;
  onTutorChange?: (tutor: Tutor | undefined) => void;
  /**
   * Where the button sits inside its (position: relative) container. Default: bottom-right.
   * The panel itself is portalled to <body> and positioned from the button, so a scrolling
   * or overflow-hidden pane can never clip it.
   */
  className?: string;
  /** Which edge of the button the panel lines up with. */
  align?: "left" | "right";
};

type Place = { left?: number; right?: number; bottom: number; maxHeight: number };

const GAP = 10;
const EDGE = 8;

/**
 * Live Tutor as a toggleable floating action: a tinted glass pill in the page's innermost
 * layer that opens the tutor (pick a tutor, start/leave a call, captions) in a glass panel.
 * The panel stays mounted once opened, so closing it keeps a live call (and its video) going.
 */
export function LiveTutorFab(props: Props) {
  return props.call ? <Fab {...props} call={props.call} /> : <OwnedFab {...props} />;
}

function OwnedFab(props: Props) {
  const call = useAvatarCall();
  return <Fab {...props} call={call} />;
}

function Fab({ call, onTutorChange, className = "absolute bottom-4 right-4", align = "right" }: Props & { call: AvatarCall }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const inCall = call.status === "connecting" || call.status === "live";

  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPlace({
      ...(align === "right" ? { right: Math.max(EDGE, vw - r.right) } : { left: Math.max(EDGE, r.left) }),
      bottom: Math.max(EDGE, vh - r.top + GAP),
      maxHeight: Math.max(260, r.top - GAP - EDGE),
    });
  }, [align]);

  // Until the panel (and its tile) is first opened, still report the default tutor so the
  // page's out-of-call answers use that tutor's voice (the tile takes over once mounted).
  useEffect(() => {
    if (mounted || !onTutorChange) return;
    const ctl = new AbortController();
    listTutors(ctl.signal).then(
      (t) => {
        if (!ctl.signal.aborted) onTutorChange(t[0]);
      },
      () => {}
    );
    return () => ctl.abort();
  }, [mounted, onTutorChange]);

  const toggle = () => {
    measure();
    setMounted(true);
    setOpen((o) => !o);
  };

  // Follow the button while open (window resize, any scrolling pane) and close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, measure]);

  return (
    <div className={`${className} z-40`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        aria-label={open ? "Hide live tutor" : "Live tutor"}
        title={open ? "Hide live tutor" : "Live tutor"}
        className="apple-tint apple-press apple-focus relative flex h-10 min-w-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold sm:px-4"
      >
        <GraduationCap className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden whitespace-nowrap sm:inline">{open ? "Hide tutor" : "Live tutor"}</span>
        {inCall && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3" aria-hidden>
            <span className="st-ping absolute inset-0 rounded-full bg-[var(--status-support)]" />
            <span className="relative h-3 w-3 rounded-full border-2 border-[var(--bg-surface-solid)] bg-[var(--status-support)]" />
          </span>
        )}
        {inCall && <span className="sr-only">(call in progress)</span>}
      </button>

      {mounted &&
        place &&
        createPortal(
          <section
            id={panelId}
            role="dialog"
            aria-label="Live tutor"
            hidden={!open}
            style={{
              position: "fixed",
              left: place.left,
              right: place.right,
              bottom: place.bottom,
              maxHeight: place.maxHeight,
              zIndex: 60,
            }}
            className="apple-glass-elevated apple-materialize w-[min(340px,calc(100vw-16px))] overflow-y-auto rounded-[24px] border p-3"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
              <h2 className="apple-heading flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <GraduationCap className="h-4 w-4 text-[var(--accent)]" aria-hidden />
                Live tutor
              </h2>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  btnRef.current?.focus();
                }}
                aria-label="Close live tutor"
                title="Close (the call keeps going)"
                className="apple-press apple-focus grid h-7 w-7 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <LiveAvatarTile call={call} onTutorChange={onTutorChange} allowPopOut={false} />
          </section>,
          document.body
        )}
    </div>
  );
}
