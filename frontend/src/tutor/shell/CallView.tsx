"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { BoardHandle, CircleEvent } from "@/tutor/contracts/types";
import { CaptionsOverlay } from "./CaptionsOverlay";
import { ControlBar } from "./ControlBar";
import { SidePanel } from "./SidePanel";
import { Stage, type StageTab } from "./Stage";
import type { TutorSession } from "./useTutorSession";
import { VideoTiles } from "./VideoTiles";

type Props = {
  session: TutorSession;
  boardRef: React.RefObject<BoardHandle | null>;
  tutorName: string;
  trackId: string;
  trackTitle: string;
  onLeave: () => void;
};

export function CallView({ session: s, boardRef, tutorName, trackId, trackTitle, onLeave }: Props) {
  const [tab, setTab] = useState<StageTab>("board");
  const [circleMode, setCircleMode] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const live = s.status === "live";

  // Shared content takes the stage when sharing starts, like Zoom; back to the board when it stops.
  const sharing = !!s.screenTrack;
  const wasSharing = useRef(sharing);
  useEffect(() => {
    if (sharing !== wasSharing.current) setTab(sharing ? "screen" : "board");
    wasSharing.current = sharing;
  }, [sharing]);

  useEffect(() => {
    boardRef.current?.setCircleMode(circleMode && tab === "board");
  }, [boardRef, circleMode, tab]);

  const onCircle = (e: CircleEvent) => {
    s.sendCircle(e);
    setCircleMode(false); // one circle per click, then back to drawing
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">{trackTitle}</span>
          <span className="text-slate-500">with {tutorName}</span>
        </div>
        {live ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
          </span>
        ) : (
          <span role="status" className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Connecting…
          </span>
        )}
      </header>

      {/* Narrow windows stack stage over side panel and scroll; the stage keeps real height so the board can render. */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row lg:overflow-hidden">
        <Stage
          tab={tab}
          onTab={setTab}
          boardRef={boardRef}
          onCircle={onCircle}
          screenTrack={s.screenTrack}
          circleMode={circleMode}
          onShare={s.toggleShare}
        >
          {captionsOn && <CaptionsOverlay captions={s.captions} tutorName={tutorName} />}
        </Stage>
        <aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-80 xl:w-96">
          <VideoTiles
            tutorName={tutorName}
            connecting={!live}
            avatarVideo={s.avatarVideo}
            tutorSpeaking={s.tutorSpeaking}
            selfVideo={s.selfVideo}
            cam={s.cam}
            mic={s.mic}
          />
          <SidePanel trackId={trackId} lessonId={s.lessonId} live={live} captions={s.captions} tutorName={tutorName} />
        </aside>
      </main>

      <ControlBar
        mic={s.mic}
        cam={s.cam}
        sharing={s.sharing}
        boardShown={tab === "board"}
        circleMode={circleMode}
        captionsOn={captionsOn}
        onMic={s.toggleMic}
        onCam={s.toggleCam}
        onShare={s.toggleShare}
        onBoard={() => setTab("board")}
        onCircle={() => setCircleMode((c) => !c)}
        onLost={s.sendLost}
        onCaptions={() => setCaptionsOn((c) => !c)}
        onSendText={s.sendText}
        onLeave={onLeave}
      />
    </div>
  );
}
