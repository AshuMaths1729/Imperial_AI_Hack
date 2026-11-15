"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, GraduationCap, Loader2 } from "lucide-react";
import type { BoardHandle } from "@/tutor/contracts/types";
import { listTracks, listTutors, type Track, type Tutor } from "@/tutor/shell/api";
import { CallView } from "@/tutor/shell/CallView";
import { Lobby } from "@/tutor/shell/Lobby";
import { downloadTranscript } from "@/tutor/shell/lesson";
import type { Caption } from "@/tutor/shell/session";
import { LessonPanel, useTrackData } from "@/tutor/shell/SidePanel";
import { useTutorSession } from "@/tutor/shell/useTutorSession";

type RecapProps = { trackId: string; lessonId?: string; onBack: () => void; onDownload?: () => void };

function Recap({ trackId, lessonId, onBack, onDownload }: RecapProps) {
  // the agent posts the lesson summary a few seconds after the room closes; keep polling for it
  const [data] = useTrackData(trackId, true);
  const ended = !!data?.lessons.some((l) => l.lesson_id === lessonId && l.ended_at);
  return (
    <div className="st-glass mx-auto my-6 w-[calc(100%-2rem)] max-w-xl space-y-5 rounded-[20px] p-6">
      <h2 className="text-lg font-semibold">Lesson ended</h2>
      {!ended && (
        <p role="status" className="flex items-center gap-2 text-sm text-[var(--st-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Your tutor is writing the recap…
        </p>
      )}
      {data && <LessonPanel {...data} lessonId={lessonId} />}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onBack}
          className="rounded-full bg-[var(--st-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--st-accent-fg)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--st-accent-hover)] active:scale-[0.98]"
        >
          Back to lobby
        </button>
        {onDownload && (
          <button
            onClick={onDownload}
            className="flex items-center gap-1.5 rounded-full border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-4 py-2.5 text-sm font-medium transition-[transform,border-color] duration-150 ease-out hover:border-[var(--st-accent)] active:scale-[0.98]"
          >
            <Download className="h-4 w-4" aria-hidden /> Download transcript
          </button>
        )}
      </div>
    </div>
  );
}

export default function TutorPage() {
  const boardRef = useRef<BoardHandle | null>(null);
  const session = useTutorSession(boardRef);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [tutorId, setTutorId] = useState("");
  const [trackId, setTrackId] = useState("");
  // The finished lesson's transcript stays downloadable on the recap screen.
  const [ended, setEnded] = useState<{ lessonId?: string; captions: Caption[] } | null>(null);

  useEffect(() => {
    Promise.all([listTutors(), listTracks()]).then(
      ([tu, tr]) => {
        setTutors(tu);
        setTracks(tr);
      },
      (e) => setLoadError(`Couldn't load tutors and tracks (${e instanceof Error ? e.message : e}). Is the backend running on :8000?`)
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
        trackId={trackId}
        trackTitle={track?.title ?? ""}
        onLeave={() => {
          if (session.lessonId) setEnded({ lessonId: session.lessonId, captions: session.captions }); // no lesson yet → straight back to the lobby
          session.end();
        }}
      />
    );
  }

  return (
    <div className="tutor-field min-h-dvh pb-6">
      <header className="st-glass mx-3 mt-3 flex h-14 items-center justify-between rounded-[18px] px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--st-accent)] text-[var(--st-accent-fg)]">
            <GraduationCap className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">ScholarTwin Live Tutor</h1>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--st-muted)]">Face-to-face lessons · slides · whiteboard</p>
          </div>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-xs font-medium text-[var(--st-text-2)] underline-offset-4 transition-colors hover:text-[var(--st-text)] hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Workspace
        </Link>
      </header>
      {ended ? (
        <Recap
          trackId={trackId}
          lessonId={ended.lessonId}
          onBack={() => setEnded(null)}
          onDownload={ended.captions.length ? () => downloadTranscript(ended.captions, tutor?.name ?? "Tutor", track?.title ?? "") : undefined}
        />
      ) : (
        <Lobby
          tutors={tutors}
          tracks={tracks}
          tutorId={tutorId}
          trackId={trackId}
          onTutor={setTutorId}
          onTrack={setTrackId}
          onTracksChange={setTracks}
          onJoin={() => void session.start(trackId, tutorId)}
          error={session.status === "error" ? session.error : undefined}
          loadError={loadError}
        />
      )}
    </div>
  );
}
