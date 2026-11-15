"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, GraduationCap, type LucideIcon } from "lucide-react";
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
  /** Screen-specific buttons, placed between the theme switch and the Live Tutor link. */
  actions?: React.ReactNode;
  /** Hide the Live Tutor link (on the tutor page itself). */
  hideTutorLink?: boolean;
  /** For pages that scroll as a whole (home, libraries). */
  sticky?: boolean;
}

const BTN =
  "apple-press apple-focus flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)]";

/**
 * The one top bar every screen uses: back · icon · title/subtitle on the left; theme switch ·
 * screen actions · Live Tutor on the right. Action labels collapse to icons below lg so the
 * bar never overflows on tablets and phones.
 */
export function AppHeader({
  tone = "accent",
  back,
  icon: Icon,
  title,
  subtitle,
  actions,
  hideTutorLink,
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
      className={`apple-glass st-fade-down z-30 flex min-h-14 shrink-0 items-center justify-between gap-3 border-b px-4 py-2 lg:px-6 ${
        sticky ? "sticky top-0" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
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
            className={`h-8 w-8 shrink-0 items-center justify-center rounded-xl ${back ? "hidden sm:flex" : "flex"}`}
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
        {!hideTutorLink && (
          <a
            href="/tutor"
            aria-label="Live Tutor"
            title="Live Tutor"
            className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            <GraduationCap className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="hidden whitespace-nowrap lg:inline">Live Tutor</span>
          </a>
        )}
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
          ? { backgroundColor: t.color, borderColor: t.color, color: "var(--accent-fg)" }
          : { backgroundColor: t.soft, borderColor: t.border, color: t.color }
      }
      className="apple-press apple-focus flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition hover:opacity-90"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className={`hidden whitespace-nowrap ${wideLabel ? "sm:inline" : "lg:inline"}`}>{label}</span>
    </button>
  );
}
