"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { AppHeader, HeaderAction } from "@/components/AppHeader";
import { MODULES } from "@/modules";
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
  /** The tutor's portrait, shown until the avatar's video arrives (and throughout for a voice-only tutor). */
  tutorPortrait?: string;
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
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-valuetext={text}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)] sm:w-24"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${value}%`, background: "linear-gradient(90deg, var(--accent), var(--status-support))" }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[var(--text-primary)]">{text}</span>
    </div>
  );
}

export function CallView({ session: s, boardRef, tutorName, tutorPortrait, trackId, trackTitle, onLeave }: Props) {
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
    // Transparent root: the body's colour field shows through the glass sheets.
    <div className="flex h-dvh flex-col overflow-hidden">
      <AppHeader
        tone={MODULES.lecture.tone}
        back={{ label: "Leave lesson", onClick: onLeave }}
        icon={MODULES.lecture.icon}
        title={trackTitle || MODULES.lecture.name}
        subtitle={`${MODULES.lecture.name} · with ${tutorName}`}
        actions={
          <>
            {live ? (
              <span
                title={`Live · ${formatElapsed(elapsed)}`}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--status-support-border)] bg-[var(--status-support-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--status-support)]"
              >
                <span className="relative grid h-2 w-2 place-items-center" aria-hidden>
                  <span className="st-ping absolute inset-0 rounded-full bg-[var(--status-support)]" />
                  <span className="h-2 w-2 rounded-full bg-[var(--status-support)]" />
                </span>
                <span className="hidden sm:inline">Live</span>
                {/* Phones keep just the live dot, so the lesson title keeps some room in the bar. */}
                <span className="font-mono tabular-nums max-sm:sr-only" aria-label={`Lesson time ${formatElapsed(elapsed)}`}>
                  {formatElapsed(elapsed)}
                </span>
              </span>
            ) : (
              <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> <span className="hidden sm:inline">Connecting…</span>
              </span>
            )}
            <HeaderAction icon={Download} label="Download transcript" onClick={download} />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-2 pb-2 pt-2.5 sm:px-3 sm:pb-3">
        {s.micError && (
          // On thick glass with a warning rim, so it reads over the landscape.
          <p role="alert" className="apple-sheet flex shrink-0 items-start gap-2 rounded-2xl !border-[var(--status-warning-border)] px-4 py-2.5 text-xs text-[var(--text-primary)]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden />
            {s.micError}
          </p>
        )}

        {/* Narrow windows stack stage over side panel and scroll; the stage keeps real height so the board can render. */}
        <main className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto lg:flex-row lg:overflow-visible">
          <Stage
            meters={
              <>
                <Meter
                  label="Progress"
                  value={progress.total ? (progress.covered / progress.total) * 100 : 0}
                  text={`${progress.covered}/${progress.total} ideas`}
                />
                <Meter label="Mastery" value={mastered ?? 0} text={mastered === null ? "—" : `${mastered}%`} />
              </>
            }
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
          <aside className="flex min-h-0 w-full shrink-0 flex-col gap-2.5 lg:w-80 xl:w-96">
            <VideoTiles
              tutorName={tutorName}
              tutorPortrait={tutorPortrait}
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
    </div>
  );
}
