"use client";

import React, { useEffect, useRef, useState } from "react";
import { stagger } from "../series/kit";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  count?: number;
}

/** Tracks which section is currently near the top of the viewport. */
export function useScrollSpy(ids: string[]): [string | null, (id: string) => void] {
  const key = ids.join("|");
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const order = key ? key.split("|") : [];
    const els = order.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = order.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      // The top margin clears the workspace header, the view tabs and the sticky section chips.
      { rootMargin: "-180px 0px -50% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
  const current = active && ids.includes(active) ? active : (ids[0] ?? null);
  return [current, setActive];
}

export function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** Sticky table of contents (wide screens). */
export function SectionNav({
  items,
  active,
  onPick,
}: {
  items: NavItem[];
  active: string | null;
  onPick: (id: string) => void;
}) {
  return (
    // Floating glass sheet; the active section is a raised segment (scroll-spy keeps it in sync).
    <nav
      aria-label="Model sections"
      className="apple-sheet sticky top-1 hidden max-h-[calc(100dvh-10rem)] self-start overflow-y-auto rounded-[26px] p-2 lg:block"
    >
      <p className="mb-1.5 px-3 pt-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">On this page</p>
      <ol className="space-y-0.5">
        {items.map((it, i) => {
          const Icon = it.icon;
          const on = it.id === active;
          return (
            <li key={it.id} className="st-fade-up" style={stagger(i, 40, 80)}>
              <a
                href={`#${it.id}`}
                aria-current={on ? "location" : undefined}
                title={it.label}
                onClick={(e) => {
                  e.preventDefault();
                  onPick(it.id);
                }}
                className={`apple-focus flex items-center gap-2 rounded-full py-1.5 pl-3 pr-2 text-[13px] transition-colors ${
                  on
                    ? "apple-seg-on font-medium text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${on ? "text-[var(--accent)]" : ""}`} />
                <span className="min-w-0 truncate">{it.label}</span>
                {it.count !== undefined && (
                  <span className="ml-auto shrink-0 rounded-full bg-[var(--bg-surface-muted)] px-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                    {it.count}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Horizontal chip nav for narrow screens. */
export function SectionChips({
  items,
  active,
  onPick,
}: {
  items: NavItem[];
  active: string | null;
  onPick: (id: string) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  // Keep the active chip fully in view as the scroll-spy moves (horizontal only, so the page
  // itself never jumps).
  useEffect(() => {
    const nav = navRef.current;
    const chip = active ? nav?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(active)}"]`) : null;
    if (!nav || !chip) return;
    const pad = 8;
    const left = chip.offsetLeft - pad;
    const right = chip.offsetLeft + chip.offsetWidth + pad;
    if (left < nav.scrollLeft) nav.scrollTo({ left });
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: right - nav.clientWidth });
  }, [active]);
  return (
    // Floating sticky capsule (thick glass: content scrolls beneath it). Scrolls sideways inside
    // itself; p-1.5 leaves room for the chips' focus rings.
    <nav
      ref={navRef}
      aria-label="Model sections"
      className="apple-glass-elevated sticky top-1 z-20 flex gap-1 overflow-x-auto rounded-full border p-1.5 [scrollbar-width:none] lg:hidden"
    >
      {items.map((it) => {
        const Icon = it.icon;
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            data-chip={it.id}
            onClick={() => onPick(it.id)}
            aria-current={on ? "location" : undefined}
            className={`apple-press apple-focus flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              on
                ? "apple-seg-on text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${on ? "text-[var(--accent)]" : ""}`} />
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Section shell with an anchored heading. The heading sits on the landscape, so it uses the
 *  on-scene ink (with its glow) in the Meadow Glass display style. */
export function Section({
  id,
  icon: Icon,
  kicker,
  title,
  aside,
  index,
  children,
}: {
  id: string;
  icon: React.ElementType;
  kicker: string;
  title: string;
  aside?: React.ReactNode;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="st-fade-up min-w-0 scroll-mt-20 lg:scroll-mt-6" style={stagger(index, 70, 60)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="apple-glass glass-lens relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border text-[var(--accent)]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="on-scene-soft font-mono text-[11px] font-medium uppercase tracking-[0.12em]">
              {String(index + 1).padStart(2, "0")} · {kicker}
            </p>
            <h2 id={`${id}-h`} className="on-scene st-display mt-0.5 text-[24px] sm:text-[26px]">
              {title}
            </h2>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
