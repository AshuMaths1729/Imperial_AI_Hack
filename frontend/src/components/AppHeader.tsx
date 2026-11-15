"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Leaf, type LucideIcon } from "lucide-react";
import { ThemeToggle } from "./ThemeProvider";

/** Each module owns one hue; the header's icon tile and back-button hover use it. */
export type HeaderTone = "accent" | "support" | "gap";

const TONES: Record<HeaderTone, { color: string; soft: string; border: string }> = {
  accent: { color: "var(--accent)", soft: "var(--accent-soft)", border: "var(--accent-border)" },
  support: { color: "var(--status-support)", soft: "var(--status-support-soft)", border: "var(--status-support-border)" },
  gap: { color: "var(--status-gap)", soft: "var(--status-gap-soft)", border: "var(--status-gap-border)" },
};

/** A hue pulled a little toward the ink, so small coloured labels stay >= 4.5:1 on their tint. */
const readable = (color: string) => `color-mix(in srgb, ${color} 84%, var(--text-primary))`;

interface AppHeaderProps {
  tone?: HeaderTone;
  /** Back navigation, always the first thing on the left. */
  back?: { label: string; onClick?: () => void; href?: string };
  icon?: LucideIcon;
  title?: string;
  subtitle?: string;
  /** Screen-specific buttons, placed after the theme switch. */
  actions?: React.ReactNode;
  /** For pages that scroll as a whole (home, libraries). */
  sticky?: boolean;
}

/**
 * The one top bar every screen uses: a floating glass capsule. Left: back · module icon tile ·
 * title / subtitle (or the Athena mark on Home, where there is nothing else). Right: theme switch
 * and screen actions. Labels collapse to icons on narrow screens so the bar never overflows.
 */
export function AppHeader({ tone = "accent", back, icon: Icon, title, subtitle, actions, sticky }: AppHeaderProps) {
  const t = TONES[tone];
  const toneVars = { "--hdr-c": t.color, "--hdr-b": t.border } as React.CSSProperties;
  const backInner = back && (
    <>
      <ArrowLeft aria-hidden className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      {/* Icon-only on phones so the screen title keeps some room. */}
      <span className="hidden max-w-[9rem] truncate sm:inline">{back.label}</span>
    </>
  );
  const backCls =
    "apple-press apple-focus group flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--hdr-b)] hover:text-[var(--hdr-c)] sm:px-3";
  const brand = !back && !title && !Icon;

  return (
    <header
      style={toneVars}
      // A floating glass capsule, inset from the window edges. It stays in normal flow, so
      // nothing below it is ever covered or clipped.
      className={`apple-glass glass-lens z-30 mx-2 mt-2 flex min-h-[52px] shrink-0 items-center justify-between gap-2 rounded-[26px] border py-1.5 pl-1.5 pr-1.5 sm:mx-3 sm:gap-3 ${
        brand ? "sm:pl-3.5" : "sm:pl-2"
      } ${sticky ? "sticky top-2" : "relative"}`}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
        {brand && (
          <span className="flex min-w-0 items-center gap-2 pl-1 text-[15px] font-medium tracking-[0.01em] text-[var(--text-primary)] sm:pl-0">
            <span
              aria-hidden
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[9px] bg-[var(--text-primary)] text-[var(--bg-canvas)]"
            >
              <Leaf className="h-[15px] w-[15px]" strokeWidth={1.9} />
            </span>
            Athena
          </span>
        )}
        {back &&
          (back.href ? (
            <Link href={back.href} aria-label={back.label} title={back.label} className={backCls}>
              {backInner}
            </Link>
          ) : (
            <button type="button" onClick={back.onClick} aria-label={back.label} title={back.label} className={backCls}>
              {backInner}
            </button>
          ))}
        {Icon && (
          <span
            aria-hidden
            style={{ backgroundColor: t.color, color: "var(--accent-fg)" }}
            className={`h-8 w-8 shrink-0 items-center justify-center rounded-[11px] shadow-[inset_0_1px_0_var(--glass-rim)] ${
              back ? "hidden sm:flex" : "flex"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.9} />
          </span>
        )}
        {title && (
          <div className="min-w-0">
            <h1 title={title} className="apple-heading truncate text-[14.5px] font-semibold leading-snug text-[var(--text-primary)]">
              {title}
            </h1>
            {subtitle && (
              <p title={subtitle} className="hidden truncate text-[12px] leading-snug text-[var(--text-muted)] sm:block">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ThemeToggle />
        {actions}
      </div>
    </header>
  );
}

/** A header action button whose label hides below lg (icon + tooltip remain). */
export function HeaderAction({
  icon: Icon,
  label,
  onClick,
  tone = "accent",
  active,
  wideLabel,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: HeaderTone;
  /** Solid fill (e.g. a mode that is switched on). */
  active?: boolean;
  /** Show the label from sm instead of lg (for a control whose state the user must notice). */
  wideLabel?: boolean;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      style={
        active
          ? ({ "--tint": t.color } as React.CSSProperties)
          : { backgroundColor: t.soft, borderColor: t.border, color: readable(t.color) }
      }
      className={`apple-press apple-focus flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold transition hover:opacity-90 sm:px-3 ${
        active ? "apple-tint" : ""
      }`}
    >
      <Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className={`hidden whitespace-nowrap ${wideLabel ? "sm:inline" : "lg:inline"}`}>{label}</span>
    </button>
  );
}
