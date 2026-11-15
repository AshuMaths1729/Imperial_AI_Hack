"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { BoardHandle, CircleEvent } from "@/tutor/contracts/types";
import type { Deck, SlidesHandle } from "@/tutor/slides";
import { getDeck } from "./api";
import { CaptionsOverlay } from "./CaptionsOverlay";
import { ControlBar } from "./ControlBar";
import { downloadTranscript, formatElapsed, keyPoints, mastery, progressOf, type DeckPosition } from "./lesson";
import { SidePanel, useLessonState, useTrackData } from "./SidePanel";
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

/** Milliseconds since `on` became true, ticking every second. */
function useElapsed(on: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!on) return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(t);
  }, [on]);
  return elapsed;
}

/** Where the deck is: the Slides tab isn't observable, so read its description once a second (only re-render on change). */
function useDeckPosition(slidesRef: React.RefObject<SlidesHandle | null>) {
  const [pos, setPos] = useState<DeckPosition | null>(null);
  useEffect(() => {
    let last = "";
    const read = () => {
      const d = slidesRef.current?.describe();
      const key = d ? `${d.index}:${d.step}:${d.slides.map((s) => `${s.id}/${s.steps}`).join(",")}` : "";
      if (key === last) return;
      last = key;
      setPos(d ? { index: d.index, step: d.step, slides: d.slides } : null);
    };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [slidesRef]);
  return pos;
}

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--st-muted)]">{label}</span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-valuetext={text}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-black/10 sm:w-28"
      >
        <div className="h-full rounded-full bg-[var(--st-accent)] transition-[width] duration-500 ease-out" style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-[var(--st-text-2)]">{text}</span>
    </div>
  );
}

export function CallView({ session: s, boardRef, tutorName, trackId, trackTitle, onLeave }: Props) {
  const [tab, setTab] = useState<StageTab>("board");
  const tabRef = useRef<StageTab>("board"); // read by the laser cues between renders
  const show = useCallback((t: StageTab) => {
    tabRef.current = t;
    setTab(t);
  }, []);
  const [circleMode, setCircleMode] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const live = s.status === "live";
  const slidesRef = useRef<SlidesHandle | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [deckLoading, setDeckLoading] = useState(true);
  const [data, setData] = useTrackData(trackId, live);
  const state = useLessonState(s.lessonId, live);
  const pos = useDeckPosition(slidesRef);
  const elapsed = useElapsed(live);
  const [explanationSlot, setExplanationSlot] = useState<HTMLElement | null>(null); // set while the side panel docks explanations

  // The deck prepared before the lesson (or the track's shipped fallback); never blocks joining.
  useEffect(() => {
    let alive = true;
    getDeck(trackId).then(
      (v) => alive && (setDeck(v.deck), setDeckLoading(false)),
      () => alive && setDeckLoading(false)
    );
    return () => {
      alive = false;
    };
  }, [trackId]);

  // The agent's RPCs and laser cues reach the stage through this (tab switching, the Slides tab).
  const setStage = s.setStage;
  useEffect(() => {
    setStage({
      showTab: show,
      tab: () => tabRef.current,
      get slides() {
        return slidesRef.current;
      },
      clearCircle: (id) => {
        slidesRef.current?.clearCircle(id);
        boardRef.current?.clearCircle(id);
      },
    });
    return () => setStage(null);
  }, [setStage, boardRef, show]);

  // Shared content takes the stage when sharing starts, like Zoom; when it stops, back to what was showing before.
  const sharing = !!s.screenTrack;
  const wasSharing = useRef(sharing);
  const beforeShare = useRef<StageTab>("board");
  useEffect(() => {
    if (sharing !== wasSharing.current) {
      if (sharing) beforeShare.current = tabRef.current === "screen" ? "board" : tabRef.current;
      show(sharing ? "screen" : beforeShare.current);
    }
    wasSharing.current = sharing;
  }, [sharing, show]);

  useEffect(() => {
    boardRef.current?.setCircleMode(circleMode && tab === "board");
  }, [boardRef, circleMode, tab]);

  const onCircle = (e: CircleEvent) => {
    s.sendCircle(e);
    setCircleMode(false); // one circle per click, then back to drawing
  };

  const progress = progressOf(pos);
  const points = keyPoints(deck, pos);
  const nowId = points[progress.now]?.id;
  const mastered = mastery(data?.track.knowledge_points ?? [], state?.concepts ?? []);
  const download = () => downloadTranscript(s.captions, tutorName, trackTitle);

  return (
    <div className="tutor-field flex h-dvh flex-col gap-3 overflow-hidden p-2 sm:p-3">
      <header className="st-glass flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-[18px] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {live ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--st-line)] bg-[var(--st-surface)] px-2.5 py-1 text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-[#2f9e5b]" aria-hidden /> Live
              <span className="font-mono tabular-nums" aria-label={`Lesson time ${formatElapsed(elapsed)}`}>
                {formatElapsed(elapsed)}
              </span>
            </span>
          ) : (
            <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--st-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Connecting…
            </span>
          )}
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{trackTitle}</h1>
          <span className="hidden shrink-0 text-sm text-[var(--st-muted)] sm:inline">with {tutorName}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <Meter
            label="Progress"
            value={progress.total ? (progress.covered / progress.total) * 100 : 0}
            text={`${progress.covered}/${progress.total} ideas`}
          />
          <Meter label="Mastery" value={mastered ?? 0} text={mastered === null ? "—" : `${mastered}%`} />
          <button
            type="button"
            onClick={download}
            aria-label="Download transcript"
            className="flex items-center gap-1.5 rounded-full border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 py-1.5 text-xs font-medium transition-[transform,border-color] duration-150 ease-out hover:border-[var(--st-accent)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-[var(--st-accent)]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Download transcript</span>
          </button>
        </div>
      </header>
      {s.micError && (
        <p role="alert" className="shrink-0 rounded-xl border border-[var(--st-warn)]/30 bg-[#f7f0e2] px-4 py-2 text-xs text-[var(--st-warn)]">
          {s.micError}
        </p>
      )}

      {/* Narrow windows stack stage over side panel and scroll; the stage keeps real height so the board can render. */}
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-hidden">
        <Stage
          tab={tab}
          onTab={show}
          boardRef={boardRef}
          onCircle={onCircle}
          emit={s.sendEvent}
          screenTrack={s.screenTrack}
          circleMode={circleMode}
          onShare={s.toggleShare}
          deck={deck}
          deckLoading={deckLoading}
          slidesRef={slidesRef}
          explanationSlot={explanationSlot}
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
            where={progress.total ? `Slide ${pos?.index} of ${pos?.slides.length}` : undefined}
          />
          <SidePanel
            trackId={trackId}
            lessonId={s.lessonId}
            tutorName={tutorName}
            points={points}
            covered={progress.covered}
            check={deck?.slides.find((x) => x.id === nowId)?.check}
            ideaNo={progress.now + 1}
            concepts={state?.concepts ?? []}
            data={data}
            onTrack={(track) => setData((d) => (d ? { ...d, track } : d))}
            deck={deck}
            onAnswer={s.sendText}
            explanationRef={setExplanationSlot}
          />
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
        onBoard={() => show("board")}
        onCircle={() => setCircleMode((c) => !c)}
        onLost={s.sendLost}
        onCaptions={() => setCaptionsOn((c) => !c)}
        onSendText={s.sendText}
        onLeave={onLeave}
      />
    </div>
  );
}
