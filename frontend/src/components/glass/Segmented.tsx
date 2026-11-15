"use client";

import React, { useCallback, useLayoutEffect, useRef } from "react";

export type SegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  /** Accessible name when `label` is icon-only. */
  ariaLabel?: string;
  title?: string;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the whole control. */
  label: string;
  /** "tabs" gives role=tablist/tab (with aria-controls up to the caller); "group" gives pressed buttons. */
  kind?: "tabs" | "group";
  className?: string;
  buttonClassName?: string;
  /** Per-option extra props, e.g. ids and aria-controls for tabs. */
  optionProps?: (value: T) => React.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string>;
};

/**
 * The Meadow Glass segmented control: a glass track whose selected option is a liquid drop that
 * slides to the new choice, squashing slightly while it moves. Use it for tabs, view switches and
 * the theme switch. Arrow keys move between options (roving tabindex).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  kind = "group",
  className = "",
  buttonClassName = "",
  optionProps,
}: Props<T>) {
  const track = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLSpanElement>(null);
  const moveTimer = useRef(0);

  const place = useCallback((animate: boolean) => {
    const t = track.current;
    const d = drop.current;
    const active = t?.querySelector<HTMLElement>('[data-active="true"]');
    if (!t || !d || !active) return;
    if (animate) {
      d.dataset.moving = "true";
      window.clearTimeout(moveTimer.current);
      moveTimer.current = window.setTimeout(() => {
        if (drop.current) drop.current.dataset.moving = "false";
      }, 240);
    }
    d.style.left = `${active.offsetLeft}px`;
    d.style.width = `${active.offsetWidth}px`;
    d.style.opacity = "1";
  }, []);

  // Position the drop under the active option (DOM measurement only, no state).
  useLayoutEffect(() => {
    place(true);
  }, [value, place]);

  useLayoutEffect(() => {
    const t = track.current;
    if (!t || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(t);
    return () => {
      ro.disconnect();
      window.clearTimeout(moveTimer.current);
    };
  }, [place]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    const next =
      e.key === "ArrowRight" ? (i + 1) % options.length
      : e.key === "ArrowLeft" ? (i - 1 + options.length) % options.length
      : e.key === "Home" ? 0
      : e.key === "End" ? options.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    track.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <div
      ref={track}
      role={kind === "tabs" ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`apple-seg relative inline-flex shrink-0 items-center gap-0.5 rounded-full p-[3px] ${className}`}
    >
      <span ref={drop} aria-hidden className="st-seg-drop apple-seg-on glass-lens" style={{ opacity: 0 }} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={kind === "tabs" ? "tab" : undefined}
            aria-selected={kind === "tabs" ? active : undefined}
            aria-pressed={kind === "group" ? active : undefined}
            aria-label={o.ariaLabel}
            title={o.title}
            tabIndex={active ? 0 : -1}
            data-active={active}
            onClick={() => onChange(o.value)}
            className={`apple-press apple-focus relative z-[1] flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            } ${buttonClassName}`}
            {...optionProps?.(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
