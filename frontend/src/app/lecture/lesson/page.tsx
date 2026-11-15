"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { AppHeader, HeaderAction } from "@/components/AppHeader";
import { useScene } from "@/components/nature/Scene";
import { MODULES } from "@/modules";
import type { BoardHandle } from "@/tutor/contracts/types";
import { tutorPortrait } from "@/tutor/media";
import { listTracks, listTutors, type Track, type Tutor } from "@/tutor/shell/api";
import { CallView } from "@/tutor/shell/CallView";
import { Lobby } from "@/tutor/shell/Lobby";
import { downloadTranscript } from "@/tutor/shell/lesson";
import type { Caption } from "@/tutor/shell/session";
import { LessonPanel, useTrackData, type TrackData } from "@/tutor/shell/SidePanel";
import { useTutorSession } from "@/tutor/shell/useTutorSession";

const LESSONS = MODULES.lecture;
/** How long the recap waits for the tutor's summary before it stops polling. */
const RECAP_WAIT_MS = 45_000;

type RecapProps = { trackId: string; lessonId?: string; onBack: () => void };

function Recap({ trackId, lessonId, onBack }: RecapProps) {
  // the agent posts the lesson summary a few seconds after the room closes; poll for it, and stop once it's in
  const isEnded = (d: TrackData) => d.lessons.some((l) => l.lesson_id === lessonId && !!l.ended_at);
  // Give the agent a while to post the summary; after that stop waiting (it may never come, e.g. a lesson that
  // was left before the tutor joined) and say where it will appear instead of spinning forever.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGaveUp(true), RECAP_WAIT_MS);
    return () => window.clearTimeout(t);
  }, []);
  const [data] = useTrackData(trackId, !gaveUp, isEnded);
  const ended = !!data && isEnded(data);
  return (
    <div className="mx-auto w-full max-w-[760px] px-3 pb-10 sm:px-5">
      <div className="st-fade-up grid grid-cols-1 gap-2.5 px-1 pb-6 pt-8 sm:pt-12">
        <p className="on-scene font-mono text-[11px] font-medium uppercase tracking-[0.12em]">Recap</p>
        <h2 id="recap-heading" className="st-display on-scene text-[clamp(32px,5vw,52px)]">
          Lesson ended. <span className="on-scene-soft">Here&apos;s where you are.</span>
        </h2>
      </div>
      <section aria-labelledby="recap-heading" className="apple-sheet st-fade-up grid grid-cols-1 gap-5 rounded-[26px] p-4 sm:p-6" style={{ animationDelay: "80ms" }}>
        {!ended && !gaveUp && (
          <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Your tutor is writing the recap…
          </p>
        )}
        {!ended && gaveUp && (
          <p role="status" aria-live="polite" className="text-sm text-[var(--text-secondary)]">
            No recap for this lesson yet. If your tutor writes one, it will show under this topic next time you open it.
          </p>
        )}
        {data && <LessonPanel {...data} lessonId={lessonId} />}
        <div>
          <button
            onClick={onBack}
            className="apple-tint st-sheen apple-press apple-focus relative inline-flex items-center gap-2 overflow-hidden rounded-full px-5 py-2.5 text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to lobby
          </button>
        </div>
      </section>
    </div>
  );
}

/** The lesson screens: lobby → call → recap. `?track=<track_id>` preselects a topic (Home's recent list, "Ask a tutor
    about this"); an id the backend doesn't know is ignored. */
function LessonScreens() {
  useScene(LESSONS.scene, true);
  const boardRef = useRef<BoardHandle | null>(null);
  const session = useTutorSession(boardRef);
  const wanted = useSearchParams()?.get("track") ?? "";
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [tutorId, setTutorId] = useState("");
  // null until the student picks one: until then the URL's track (once it is known to exist) is the choice
  const [picked, setPicked] = useState<string | null>(null);
  const trackId = picked ?? (tracks.some((t) => t.track_id === wanted) ? wanted : "");
  // The finished lesson's transcript stays downloadable on the recap screen.
  const [ended, setEnded] = useState<{ lessonId?: string; captions: Caption[] } | null>(null);

  useEffect(() => {
    Promise.all([listTutors(), listTracks()]).then(
      ([tu, tr]) => {
        setTutors(tu);
        setTracks(tr);
      },
      (e) => setLoadError(`Couldn't load tutors and topics (${e instanceof Error ? e.message : e}). Is the backend running on :8000?`)
    );
  }, []);

  const tutor = tutors.find((t) => t.tutor_id === tutorId);
  const track = tracks.find((t) => t.track_id === trackId);

  if (session.status === "connecting" || session.status === "live") {
    return (
      <CallView
        session={session}
        boardRef={boardRef}
        tutorName={tutor?.name ?? "Tutor"}
        tutorPortrait={tutorPortrait(tutor)}
        trackId={trackId}
        trackTitle={track?.title ?? ""}
        onLeave={() => {
          if (session.lessonId) setEnded({ lessonId: session.lessonId, captions: session.captions }); // no lesson yet → straight back to the lobby
          session.end();
        }}
      />
    );
  }

  const download = ended?.captions.length ? () => downloadTranscript(ended.captions, tutor?.name ?? "Tutor", track?.title ?? "") : undefined;
  return (
    // Transparent root: the landscape shows through around the glass sheets.
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        tone={LESSONS.tone}
        back={{ label: "Home", href: "/" }}
        icon={LESSONS.icon}
        title={LESSONS.name}
        subtitle={ended && track ? `${track.title}${tutor ? ` · with ${tutor.name}` : ""}` : "Slides, a whiteboard and a tutor who listens"}
        actions={download && <HeaderAction icon={Download} label="Download transcript" onClick={download} />}
      />
      {ended ? (
        <Recap trackId={trackId} lessonId={ended.lessonId} onBack={() => setEnded(null)} />
      ) : (
        <Lobby
          tutors={tutors}
          tracks={tracks}
          tutorId={tutorId}
          trackId={trackId}
          onTutor={setTutorId}
          onTrack={setPicked}
          onTracksChange={setTracks}
          onJoin={() => void session.start(trackId, tutorId)}
          error={session.status === "error" ? session.error : undefined}
          loadError={loadError}
        />
      )}
    </div>
  );
}

export default function LessonPage() {
  // useSearchParams needs a Suspense boundary: the header shows while the rest renders on the client.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh flex-col">
          <AppHeader tone={LESSONS.tone} back={{ label: "Home", href: "/" }} icon={LESSONS.icon} title={LESSONS.name} />
        </div>
      }
    >
      <LessonScreens />
    </Suspense>
  );
}
