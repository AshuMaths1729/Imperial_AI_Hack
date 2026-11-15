"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { WorkspaceMode } from "../types/scholartwin";
import { MODULES, MODULE_ORDER, type ModuleInfo } from "../modules";
import { AppHeader } from "./AppHeader";
import type { LibraryTopic } from "./LibraryView";
import { ModuleArt } from "./home/ModuleArt";
import { RecentList } from "./home/RecentList";

const LESSON_ROUTE = "/lecture/lesson";

interface HomeHubProps {
  onSelectMode: (mode: WorkspaceMode) => void;
  /** Paper Simulator library, for "Pick up where you left off". */
  papers?: LibraryTopic[];
  onOpenPaper?: (topic: LibraryTopic) => void;
  onDeletePaper?: (id: string) => void;
  onOpenEvidence?: (topicId: string) => void;
}

const NO_PAPERS: LibraryTopic[] = [];
const noop = () => {};

/* apple-card (unlayered CSS) transitions translate itself; the lift is a Tailwind translate. */
const CARD =
  "apple-card glass-lens apple-focus relative flex h-full w-full flex-col rounded-[26px] border text-left text-[var(--text-primary)] hover:-translate-y-1 focus-visible:-translate-y-1";

function ModuleCard({ mod, onSelect, delay }: { mod: ModuleInfo; onSelect: () => void; delay: number }) {
  const inner = (
    // The sheen sweeps across this inner layer: glass-lens owns the card's ::after.
    <span className="st-sheen relative flex h-full flex-col gap-3.5 overflow-hidden rounded-[inherit] p-2.5">
      <span
        className="relative block h-40 overflow-hidden rounded-[18px] shadow-[inset_0_1px_0_var(--glass-highlight),inset_0_0_0_1px_var(--border-subtle)]"
        style={{
          background: `radial-gradient(90% 120% at 85% 0%, color-mix(in srgb, ${mod.hue} 26%, transparent), transparent 70%), linear-gradient(160deg, color-mix(in srgb, ${mod.hue} 12%, var(--bg-surface-solid)), var(--bg-surface-solid))`,
        }}
      >
        <ModuleArt module={mod.id} />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 px-2 pb-2.5 pt-0.5">
        <span
          className="font-mono text-[11.5px] font-medium uppercase leading-none tracking-[0.12em]"
          style={{ color: `color-mix(in srgb, ${mod.hue} 82%, var(--text-primary))` }}
        >
          {mod.verb}
        </span>
        <span id={`module-${mod.id}-name`} className="text-[22px] leading-tight tracking-[-0.025em]">
          {mod.name}
        </span>
        <span id={`module-${mod.id}-desc`} className="text-[14.5px] leading-relaxed text-[var(--text-secondary)]">
          {mod.description}
        </span>
        <span
          className="mt-auto flex items-center justify-between pt-2 text-[14px] font-medium"
          style={{ color: `color-mix(in srgb, ${mod.hue} 82%, var(--text-primary))` }}
        >
          {mod.cta}
          <ArrowRight aria-hidden className="h-[17px] w-[17px]" />
        </span>
      </span>
    </span>
  );
  const style = { animationDelay: `${delay}ms` };
  // Named by the module, described by its sentence (the drawing and the CTA stay visual).
  const a11y = { "aria-labelledby": `module-${mod.id}-name`, "aria-describedby": `module-${mod.id}-desc` };
  return (
    <li className="st-fade-up min-w-0" style={style}>
      {mod.id === "lecture" ? (
        <Link href={LESSON_ROUTE} className={CARD} {...a11y}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onSelect} className={CARD} {...a11y}>
          {inner}
        </button>
      )}
    </li>
  );
}

export function HomeHub({
  onSelectMode,
  papers = NO_PAPERS,
  onOpenPaper = noop,
  onDeletePaper = noop,
  onOpenEvidence = noop,
}: HomeHubProps) {
  return (
    // Transparent root so the landscape (components/nature/Scene) shows through.
    <div className="relative flex min-h-screen flex-col overflow-x-clip text-[var(--text-primary)]">
      <AppHeader sticky />

      <main className="relative mx-auto w-full max-w-[1180px] flex-1 px-4 pb-16 sm:px-6">
        <section className="pb-[clamp(36px,7vh,76px)] pt-[clamp(56px,13vh,140px)] text-center">
          <h1 className="st-display on-scene st-fade-up text-[clamp(64px,11vw,132px)] !leading-[0.95] !tracking-[-0.05em]">
            Athena
          </h1>
          <p
            className="on-scene st-fade-up mx-auto mt-4 max-w-[560px] text-[clamp(16px,2vw,19px)] font-[450] leading-normal"
            style={{ animationDelay: "80ms" }}
          >
            Learn a topic with a live tutor, play with the maths inside a paper, and see where the research agrees.
          </p>
        </section>

        <ul aria-label="Modules" className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {MODULE_ORDER.map((id, i) => (
            <ModuleCard key={id} mod={MODULES[id]} onSelect={() => onSelectMode(id)} delay={220 + i * 80} />
          ))}
        </ul>

        <RecentList
          papers={papers}
          onOpenPaper={onOpenPaper}
          onDeletePaper={onDeletePaper}
          onOpenEvidence={onOpenEvidence}
        />
      </main>
    </div>
  );
}
