"use client";

import { useState, type ReactNode, type Ref, type RefObject } from "react";
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
  children?: ReactNode; // overlays (captions)
};

export function Stage({ tab, onTab, boardRef, onCircle, emit, screenTrack, circleMode, onShare, deck = null, deckLoading, slidesRef, children }: Props) {
  const [screenVideo, setScreenVideo] = useState<HTMLVideoElement | null>(null);
  const tabs: [StageTab, string][] = [
    ["board", "Whiteboard"],
    ["slides", "Slides"],
    ["screen", "Shared screen"],
  ];
  return (
    <section aria-label="Main stage" className="flex min-h-[60vh] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 lg:min-h-0 lg:flex-1 lg:shrink">
      <div role="tablist" aria-label="Stage" className="flex shrink-0 items-center gap-1 border-b border-slate-800 px-2 py-1.5">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === id ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
            {id === "screen" && screenTrack && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* The board stays mounted while hidden: the agent's board RPCs need it during the whole lesson. */}
        <div className={`absolute inset-0 bg-white ${tab === "board" ? "" : "invisible"}`}>
          <Whiteboard ref={boardRef} onCircle={onCircle} plugins={BOARD_PLUGINS} emit={emit} />
        </div>
        {/* Mounted for the whole lesson too: the agent drives the deck over RPC even before the tab is shown. */}
        <div className={`absolute inset-0 ${tab === "slides" ? "" : "invisible"}`}>
          <SlidesStage ref={slidesRef} deck={deck} loading={deckLoading} circleMode={circleMode && tab === "slides"} onCircle={onCircle} />
        </div>
        <div className={`absolute inset-0 bg-slate-950 ${tab === "screen" ? "" : "invisible"}`}>
          {screenTrack ? (
            <>
              <TrackVideo ref={setScreenVideo} track={screenTrack} fit="contain" label="Your shared screen" />
              {circleMode && tab === "screen" && <ScreenCircle video={screenVideo} onCircle={onCircle} />}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-slate-400">Share a window — your notes or a problem sheet — and the tutor can see it.</p>
              <button
                onClick={onShare}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-[transform,background-color] duration-150 ease-out hover:bg-sky-400 active:scale-[0.97]"
              >
                <MonitorUp className="h-4 w-4" aria-hidden />
                Share screen
              </button>
            </div>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
