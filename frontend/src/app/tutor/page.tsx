"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GraduationCap, Loader2 } from "lucide-react";
import type { BoardHandle } from "@/tutor/contracts/types";
import { listTracks, listTutors, type Track, type Tutor } from "@/tutor/shell/api";
import { CallView } from "@/tutor/shell/CallView";
import { Lobby } from "@/tutor/shell/Lobby";
import { LessonPanel, useTrackData } from "@/tutor/shell/SidePanel";
import { useTutorSession } from "@/tutor/shell/useTutorSession";

function Recap({ trackId, lessonId, onBack }: { trackId: string; lessonId?: string; onBack: () => void }) {
  // the agent posts the lesson summary a few seconds after the room closes; keep polling for it
  const [data] = useTrackData(trackId, true);
  const ended = !!data?.lessons.some((l) => l.lesson_id === lessonId && l.ended_at);
  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 py-10">
      <h2 className="text-lg font-semibold">Lesson ended</h2>
      {!ended && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Your tutor is writing the recap…
        </p>
      )}
      {data && <LessonPanel {...data} lessonId={lessonId} />}
      <button
        onClick={onBack}
        className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-[transform,background-color] duration-150 ease-out hover:bg-sky-400 active:scale-[0.98]"
      >
        Back to lobby
      </button>
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
  const [ended, setEnded] = useState<{ lessonId?: string } | null>(null);

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
          setEnded({ lessonId: session.lessonId });
          session.end();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <GraduationCap className="h-4 w-4" aria-hidden />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">ScholarTwin Live Tutor</h1>
            <p className="text-[11px] text-slate-400">Face-to-face lessons with a shared whiteboard</p>
          </div>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-slate-100">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Workspace
        </Link>
      </header>
      {ended ? (
        <Recap trackId={trackId} lessonId={ended.lessonId} onBack={() => setEnded(null)} />
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
