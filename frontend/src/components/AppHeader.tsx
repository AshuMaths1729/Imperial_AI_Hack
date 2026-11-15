"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { ThemeToggle } from "./ThemeProvider";

/** Each module owns one status hue; the header's icon tile and back-button hover use it. */
export type HeaderTone = "accent" | "support" | "gap";

const TONES: Record<HeaderTone, { color: string; soft: string; border: string }> = {
  accent: { color: "var(--accent)", soft: "var(--accent-soft)", border: "var(--accent-border)" },
  support: { color: "var(--status-support)", soft: "var(--status-support-soft)", border: "var(--status-support-border)" },
  gap: { color: "var(--status-gap)", soft: "var(--status-gap-soft)", border: "var(--status-gap-border)" },
};

interface AppHeaderProps {
  tone?: HeaderTone;
  /** Back navigation, always the first thing on the left. */
  back?: { label: string; onClick?: () => void; href?: string };
  icon?: LucideIcon;
  title?: string;
  subtitle?: string;
  /** Screen-specific buttons, placed after the theme switch. (Live Tutor is not in the bar:
   *  each workspace offers it as a floating LiveTutorFab inside its content.) */
  actions?: React.ReactNode;
  /** For pages that scroll as a whole (home, libraries). */
  sticky?: boolean;
}

const BTN =
  "apple-press apple-focus flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]";

/**
 * The one top bar every screen uses, as a floating glass capsule: back · icon · title/subtitle
 * on the left; theme switch · screen actions on the right. Action labels collapse to icons
 * below lg so the bar never overflows on tablets and phones.
 */
export function AppHeader({
  tone = "accent",
  back,
  icon: Icon,
  title,
  subtitle,
  actions,
  sticky,
}: AppHeaderProps) {
  const t = TONES[tone];
  const toneVars = { "--hdr-c": t.color, "--hdr-b": t.border } as React.CSSProperties;
  const backInner = back && (
    <>
      <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
      {/* Icon-only on phones so the screen title keeps some room. */}
      <span className="hidden max-w-[9rem] truncate sm:inline">{back.label}</span>
    </>
  );
  const backCls = `${BTN} group hover:border-[var(--hdr-b)] hover:text-[var(--hdr-c)]`;

  return (
    <header
      style={toneVars}
      // A floating glass capsule, inset from the window edges; it stays in normal flow, so
      // nothing below it is ever covered or clipped.
      className={`apple-glass glass-lens st-fade-down z-30 mx-2 mt-2 flex min-h-14 shrink-0 items-center justify-between gap-2 rounded-[28px] sm:gap-3 border px-2.5 py-2 sm:mx-3 sm:px-3 lg:px-4 ${
        sticky ? "sticky top-2" : "relative"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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
          <div
            style={{ backgroundColor: t.soft, color: t.color }}
            className={`h-8 w-8 shrink-0 items-center justify-center rounded-[11px] ${back ? "hidden sm:flex" : "flex"}`}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
        {title && (
          <div className="min-w-0">
            <h1 title={title} className="apple-heading truncate text-sm font-bold leading-snug text-[var(--text-primary)]">
              {title}
            </h1>
            {subtitle && (
              <p title={subtitle} className="hidden truncate text-[11px] leading-snug text-[var(--text-muted)] sm:block">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
          : { backgroundColor: t.soft, borderColor: t.border, color: t.color }
      }
      className={`apple-press apple-focus flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:opacity-90 ${
        active ? "apple-tint" : ""
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className={`hidden whitespace-nowrap ${wideLabel ? "sm:inline" : "lg:inline"}`}>{label}</span>
    </button>
  );
}
