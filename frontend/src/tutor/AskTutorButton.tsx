"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, GraduationCap, Loader2 } from "lucide-react";
import { askTutorError, lessonHref, openLessonTrack, type AskTutorTopic } from "./askTutor";

export type { AskTutorTopic } from "./askTutor";

/**
 * "Ask a tutor about this": opens a Live Lesson whose topic is the paper or evidence map on screen.
 * Replaces the old floating LiveTutorFab (which called a retired tutor service).
 *
 * Click: reuse the learning track already made for this topic (same title and material ref) or create one
 * with the topic as its material, then open /lecture/lesson?track=<id>, where the student picks a tutor.
 * `className` positions the control; an error shows under the capsule, right-aligned.
 */
export function AskTutorButton({ topic, className = "" }: { topic: AskTutorTopic; className?: string }) {
  const router = useRouter();
  // A transition, not a flag: it stays pending until the lesson page has rendered, and ends by itself if
  // this screen is kept alive (Next preserves routes with <Activity>) and the student comes back.
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const start = () => {
    setError(undefined);
    startTransition(async () => {
      try {
        const trackId = await openLessonTrack(topic);
        startTransition(() => router.push(lessonHref(trackId)));
      } catch (e) {
        setError(askTutorError(e));
      }
    });
  };

  return (
    <span className={`inline-flex max-w-full flex-col items-end gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={start}
        disabled={pending}
        aria-busy={pending}
        title={`Start a live lesson about ${topic.title}`}
        className="apple-glass glass-lens apple-press apple-focus relative inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold text-[var(--text-primary)] disabled:cursor-progress"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" aria-hidden />
        ) : (
          <GraduationCap className="h-4 w-4 text-[var(--accent)]" aria-hidden />
        )}
        {pending ? "Setting up your lesson…" : "Ask a tutor about this"}
      </button>
      <span role="status" className="sr-only">
        {pending ? "Setting up your lesson…" : ""}
      </span>
      {error && !pending && (
        <p
          role="alert"
          className="apple-glass flex max-w-xs items-start gap-1.5 rounded-2xl border px-3 py-1.5 text-xs leading-snug text-[var(--text-primary)]"
        >
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--status-contradict)]" aria-hidden />
          {error}
        </p>
      )}
    </span>
  );
}
