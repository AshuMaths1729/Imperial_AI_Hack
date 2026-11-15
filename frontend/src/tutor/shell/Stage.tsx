"use client";

import { useEffect, useState, type ReactNode, type Ref, type RefObject } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { MonitorUp } from "lucide-react";
import { BOARD_PLUGINS, Whiteboard } from "@/tutor/board";
import type { BoardHandle, CircleEvent } from "@/tutor/contracts/types";
import { SlidesStage, type Deck, type SlidesHandle, type StageTab } from "@/tutor/slides";
import { ScreenCircle } from "./ScreenCircle";
import { TrackVideo } from "./VideoTiles";

export type { StageTab };

type Props = {
  tab: StageTab;
  onTab: (t: StageTab) => void;
  boardRef: RefObject<BoardHandle | null>;
  onCircle: (e: CircleEvent) => void;
  /** Sends a board plugin event to the agent (LiveKit text stream). */
  emit?: (topic: string, payload: unknown) => void;
  screenTrack?: LocalVideoTrack;
  circleMode: boolean;
  onShare: () => void;
  deck?: Deck | null;
  deckLoading?: boolean;
  slidesRef?: Ref<SlidesHandle | null>;
  /** The side panel's slot for the explanation pop-up, or null for the stage's bottom-right corner. */
  explanationSlot?: HTMLElement | null;
  children?: ReactNode; // a strip under the stage (captions)
};

// Hidden panes stay mounted for the agent's RPCs. opacity-0 too: slide animations set visibility:visible on
// their own dots and lines, which beats the parent's visibility:hidden and paints them over the whiteboard.
const HIDDEN = "invisible opacity-0 pointer-events-none";
// Tab changes cross-fade (~1 s) under a short label, so the stage never jumps; instant with reduced motion.
const FADE_MS = 1000;
const FADE = "transition-opacity duration-1000 ease-in-out motion-reduce:transition-none";
const MOVING: Record<StageTab, string> = {
  board: "Moving to the whiteboard…",
  slides: "Back to the slides…",
  screen: "Moving to your shared screen…",
};
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Stage({ tab, onTab, boardRef, onCircle, emit, screenTrack, circleMode, onShare, deck = null, deckLoading, slidesRef, explanationSlot = null, children }: Props) {
  const [screenVideo, setScreenVideo] = useState<HTMLVideoElement | null>(null);
  // `leaving` is the tab still fading out; derived during render so the old pane never blinks out before fading.
  const [fade, setFade] = useState<{ tab: StageTab; leaving: StageTab | null }>({ tab, leaving: null });
  if (fade.tab !== tab) setFade({ tab, leaving: reducedMotion() ? null : fade.tab });
  useEffect(() => {
    if (!fade.leaving) return;
    const t = setTimeout(() => setFade((f) => ({ ...f, leaving: null })), FADE_MS);
    return () => clearTimeout(t);
  }, [fade]);
  const pane = (id: StageTab) => (id === tab ? FADE : id === fade.leaving ? `${FADE} opacity-0 pointer-events-none` : HIDDEN);
  const tabs: [StageTab, string][] = [
    ["board", "Whiteboard"],
    ["slides", "Slides"],
    ["screen", "Shared screen"],
  ];
  return (
    <section aria-label="Main stage" className="st-glass flex min-h-[60vh] shrink-0 flex-col gap-2 overflow-hidden rounded-[20px] p-2 lg:min-h-0 lg:flex-1 lg:shrink">
      <div role="tablist" aria-label="Stage" className="flex shrink-0 items-center gap-1 self-start rounded-full bg-black/5 p-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
              tab === id ? "bg-[var(--st-accent)] text-[var(--st-accent-fg)] shadow-sm" : "text-[var(--st-text-2)] hover:bg-black/5"
            }`}
          >
            {label}
            {id === "screen" && screenTrack && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#2f9e5b] align-middle" />}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[14px] bg-[#0b0d12] ring-1 ring-[var(--st-line)]">
        {/* The board stays mounted while hidden: the agent's board RPCs need it during the whole lesson. */}
        <div className={`absolute inset-0 bg-white ${pane("board")}`}>
          <Whiteboard ref={boardRef} onCircle={onCircle} plugins={BOARD_PLUGINS} emit={emit} />
        </div>
        {/* Mounted for the whole lesson too: the agent drives the deck over RPC even before the tab is shown. */}
        <div className={`absolute inset-0 ${pane("slides")}`}>
          <SlidesStage ref={slidesRef} deck={deck} loading={deckLoading} circleMode={circleMode && tab === "slides"} onCircle={onCircle} explanationSlot={explanationSlot} />
        </div>
        <div className={`absolute inset-0 bg-slate-950 ${pane("screen")}`}>
          {screenTrack ? (
            <>
              <TrackVideo ref={setScreenVideo} track={screenTrack} fit="contain" label="Your shared screen" />
              {circleMode && tab === "screen" && <ScreenCircle video={screenVideo} onCircle={onCircle} />}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-sm text-sm text-slate-300">Share a window — your notes or a problem sheet — and the tutor can see it.</p>
              <button
                onClick={onShare}
                className="flex items-center gap-2 rounded-full bg-[var(--st-accent-fg)] px-4 py-2 text-xs font-semibold text-[var(--st-accent)] transition-[transform,background-color] duration-150 ease-out hover:bg-white active:scale-[0.97]"
              >
                <MonitorUp className="h-4 w-4" aria-hidden />
                Share screen
              </button>
            </div>
          )}
        </div>
        {fade.leaving && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <span role="status" className="st-glass rounded-full px-4 py-2 text-sm font-medium text-[var(--st-text)]">
              {MOVING[tab]}
            </span>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
