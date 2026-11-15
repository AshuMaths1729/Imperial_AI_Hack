"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type GlassOption = { value: string; label: string };

type Props = {
  /** Accessible name of the control (there is no visible <label>). */
  label: string;
  value: string;
  options: GlassOption[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
};

type Place = { left: number; top?: number; bottom?: number; width: number; maxHeight: number };

const GAP = 6;
const EDGE = 8;

/**
 * A select whose open list is a Liquid Glass popover instead of the OS menu (a native <select>
 * list can't be styled: on Windows it opens white over the dark theme). Listbox pattern: the
 * button opens it, arrows/Home/End move, Enter/Space pick, Escape/Tab close. The list is portalled
 * to <body> with fixed positioning so no sheet stacked after the control can paint over it.
 */
export function GlassSelect({ label, value, options, placeholder = "Choose…", onChange, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);

  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    // Open downwards unless there's clearly more room above.
    const down = below >= 180 || below >= above;
    setPlace({
      left: r.left,
      width: r.width,
      ...(down ? { top: r.bottom + GAP } : { bottom: window.innerHeight - r.top + GAP }),
      maxHeight: Math.max(120, Math.min(320, down ? below : above)),
    });
  }, []);

  const openList = () => {
    measure();
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    close();
  };

  // Focus the list once it is mounted; follow the button while open; close on an outside press.
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, measure]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.min(last, Math.max(0, i)));
    };
    switch (e.key) {
      case "ArrowDown": return move(active + 1);
      case "ArrowUp": return move(active - 1);
      case "Home": return move(0);
      case "End": return move(last);
      case "Enter":
      case " ":
        e.preventDefault();
        return pick(active);
      case "Escape":
        e.preventDefault();
        return close();
      case "Tab":
        return close(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKey}
        className={`apple-focus flex min-w-0 items-center justify-between gap-2 rounded-full border bg-[var(--bg-surface-muted)] px-3.5 py-2 text-left text-sm transition-colors hover:border-[var(--border-strong)] ${
          open ? "border-[var(--accent-border)]" : "border-[var(--border-subtle)]"
        } ${selected ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"} ${className}`}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        place &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
            onKeyDown={onListKey}
            style={{ position: "fixed", left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.maxHeight, zIndex: 70 }}
            className="apple-glass-elevated apple-materialize overflow-y-auto rounded-2xl border p-1.5 outline-none"
          >
            {options.length === 0 && <li className="px-3 py-2 text-sm text-[var(--text-muted)]">Nothing to choose yet</li>}
            {options.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={isSel}
                  onPointerMove={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm ${
                    i === active ? "bg-[var(--accent-soft)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {isSel && <Check aria-hidden className="h-4 w-4 shrink-0 text-[var(--accent)]" />}
                </li>
              );
            })}
          </ul>,
          document.body
        )}
    </>
  );
}
