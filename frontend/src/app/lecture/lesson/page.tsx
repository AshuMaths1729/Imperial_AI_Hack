"use client";

import { useEffect, useRef, useState } from "react";
import { Download, GraduationCap, Loader2 } from "lucide-react";
import { AppHeader, HeaderAction } from "@/components/AppHeader";
import type { BoardHandle } from "@/tutor/contracts/types";
import { listTracks, listTutors, type Track, type Tutor } from "@/tutor/shell/api";
import { CallView } from "@/tutor/shell/CallView";
import { Lobby } from "@/tutor/shell/Lobby";
import { downloadTranscript } from "@/tutor/shell/lesson";
import type { Caption } from "@/tutor/shell/session";
import { LessonPanel, useTrackData } from "@/tutor/shell/SidePanel";
import { useTutorSession } from "@/tutor/shell/useTutorSession";

type RecapProps = { trackId: string; lessonId?: string; onBack: () => void };

function Recap({ trackId, lessonId, onBack }: RecapProps) {
  // the agent posts the lesson summary a few seconds after the room closes; keep polling for it
  const [data] = useTrackData(trackId, true);
  const ended = !!data?.lessons.some((l) => l.lesson_id === lessonId && l.ended_at);
  return (
    <div className="apple-sheet st-fade-up mx-auto my-auto w-full max-w-xl space-y-5 rounded-[22px] p-6">
      <h2 className="apple-heading text-lg font-semibold">Lesson ended</h2>
      {!ended && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Your tutor is writing the recap…
        </p>
      )}
      {data && <LessonPanel {...data} lessonId={lessonId} />}
      <button onClick={onBack} className="apple-tint apple-press apple-focus rounded-full px-5 py-2.5 text-sm font-semibold">
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

  const download = ended?.captions.length ? () => downloadTranscript(ended.captions, tutor?.name ?? "Tutor", track?.title ?? "") : undefined;
  return (
    // Transparent root: the body's colour field shows through the glass sheets.
    <div className="flex min-h-dvh flex-col pb-4">
      <AppHeader
        tone="accent"
        back={{ label: "Lecture workspace", href: "/" }}
        icon={GraduationCap}
        title="Live lesson"
        subtitle={ended && track ? `${track.title}${tutor ? ` · with ${tutor.name}` : ""}` : "Face-to-face lessons · slides · whiteboard"}
        actions={download && <HeaderAction icon={Download} label="Download transcript" onClick={download} />}
      />
      {ended ? (
        <div className="flex flex-1 flex-col px-3 py-4">
          <Recap trackId={trackId} lessonId={ended.lessonId} onBack={() => setEnded(null)} />
        </div>
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
