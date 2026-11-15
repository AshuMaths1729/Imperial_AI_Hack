"use client";

import React, { useEffect, useState } from "react";
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
      { rootMargin: "-110px 0px -55% 0px", threshold: 0 },
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
    <nav aria-label="Model sections" className="sticky top-6 hidden self-start lg:block">
      <p className="apple-label mb-2 px-3 text-[10px] font-semibold uppercase text-[var(--text-muted)]">On this page</p>
      <ol className="relative space-y-0.5 border-l border-[var(--border-subtle)]">
        {items.map((it, i) => {
          const Icon = it.icon;
          const on = it.id === active;
          return (
            <li key={it.id} className="st-fade-up" style={stagger(i, 40, 80)}>
              <a
                href={`#${it.id}`}
                aria-current={on ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onPick(it.id);
                }}
                className={`apple-focus relative -ml-px flex items-center gap-2 border-l-2 py-1.5 pl-3 pr-2 text-xs transition-colors ${
                  on
                    ? "border-[var(--accent)] font-semibold text-[var(--accent)]"
                    : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span className="truncate">{it.label}</span>
                {it.count !== undefined && (
                  <span className="ml-auto rounded-full bg-[var(--bg-surface-muted)] px-1.5 font-mono text-[10px] text-[var(--text-muted)]">
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
  return (
    <nav
      aria-label="Model sections"
      className="apple-glass sticky top-0 z-20 -mx-4 flex gap-1.5 overflow-x-auto border-b px-4 py-2 lg:hidden"
    >
      {items.map((it) => {
        const Icon = it.icon;
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onPick(it.id)}
            aria-current={on ? "location" : undefined}
            className={`apple-press apple-focus flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
              on
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Section shell with an anchored heading. */
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
    <section id={id} aria-labelledby={`${id}-h`} className="st-fade-up scroll-mt-28 lg:scroll-mt-6" style={stagger(index, 70, 60)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="apple-label text-[10px] font-semibold uppercase text-[var(--text-muted)]">
              <span className="font-mono">{String(index + 1).padStart(2, "0")}</span> · {kicker}
            </p>
            <h2 id={`${id}-h`} className="apple-heading text-lg font-semibold text-[var(--text-primary)]">
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
