"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video } from "lucide-react";
import { listTutors, type Tutor } from "./api";
import { AvatarVideo, Portrait, portrait } from "./media";
import type { useAvatarCall } from "./useAvatarCall";

export type AvatarCall = ReturnType<typeof useAvatarCall>;

type Props = {
  /** The call, owned by the page so its ask box can talk into the same call. */
  call: AvatarCall;
  /** The tutor on screen (picked, or live in the call), so out-of-call answers use their voice. */
  onTutorChange?: (tutor: Tutor | undefined) => void;
};

/** Live tutor in the workspace's avatar dock: portrait when idle, the Synthesia video in a call, pop-out to 512 px. */
export function LiveAvatarTile({ call, onTutorChange }: Props) {
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [picked, setPicked] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [attempt, setAttempt] = useState(0); // bump to retry loading the tutors

  useEffect(() => {
    const ctl = new AbortController();
    listTutors(ctl.signal).then(
      (t) => {
        setTutors(t);
        setPicked((p) => p ?? t[0]?.tutor_id);
        setLoadError(undefined);
      },
      (e) => {
        if (!ctl.signal.aborted) setLoadError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => ctl.abort();
  }, [attempt]);

  const inCall = call.status === "connecting" || call.status === "live";
  const activeId = inCall ? call.activeTutorId ?? picked : picked;
  const active = tutors.find((t) => t.tutor_id === activeId);

  useEffect(() => {
    onTutorChange?.(active);
  }, [active, onTutorChange]);
  const lastTutorLine = [...call.captions].reverse().find((c) => c.who === "tutor");
  const popped = expanded && !!call.avatarVideo;

  const face = (
    <>
      {call.avatarVideo ? (
        <AvatarVideo track={call.avatarVideo} label={`${active?.name ?? "Tutor"}, your tutor`} />
      ) : active ? (
        <Image src={portrait(active.tutor_id)} alt={`${active.name}, ${active.tagline}`} fill sizes="512px" className={`object-cover ${inCall ? "opacity-50" : ""}`} />
      ) : null}
      {call.status === "connecting" || (inCall && !call.avatarVideo) ? (
        <p role="status" className="absolute inset-0 flex items-center justify-center">
          <span className="apple-glass flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs text-[var(--text-primary)]">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            {active?.name ?? "Tutor"} is joining…
          </span>
        </p>
      ) : null}
      <span className="apple-glass absolute left-2 top-2 max-w-[calc(100%-3rem)] truncate rounded-md border px-2 py-0.5 text-[10px] font-medium text-[var(--text-primary)]">
        {active ? `${active.name} · ${active.tagline}` : "Live tutor"}
        {call.tutorSpeaking && <span className="ml-1 text-[var(--accent)]">· speaking</span>}
      </span>
      {call.avatarVideo && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={popped ? "Shrink tutor window" : "Expand tutor window"}
          className="apple-glass apple-press apple-focus absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border text-[var(--text-primary)] transition-colors hover:text-[var(--accent)]"
        >
          {popped ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
        </button>
      )}
    </>
  );

  const ring = call.tutorSpeaking ? "ring-[var(--accent)]" : "ring-[var(--border-subtle)]";

  return (
    // Capped so the square tile can't fill a stacked (below lg) layout; at lg the dock is narrower anyway.
    <div className="mx-auto w-full max-w-[300px] space-y-3">
      {popped ? (
        <>
          <div className="grid aspect-square w-full place-items-center rounded-xl bg-[var(--bg-surface-muted)] text-[11px] text-[var(--text-muted)] ring-1 ring-[var(--border-subtle)]">
            Showing in the large window
          </div>
          <figure
            style={{ boxShadow: "var(--shadow-elevated)" }}
            className={`fixed left-[306px] top-[72px] z-40 aspect-square w-[512px] max-w-[calc(100vw-322px)] overflow-hidden rounded-2xl bg-[var(--bg-surface-muted)] ring-2 ${ring}`}
          >
            {face}
            {lastTutorLine && (
              <figcaption aria-live="polite" className="apple-glass-elevated absolute inset-x-3 bottom-3 rounded-lg border p-2.5 text-xs leading-relaxed text-[var(--text-primary)]">
                {lastTutorLine.text}
              </figcaption>
            )}
          </figure>
        </>
      ) : (
        <figure className={`relative aspect-square w-full overflow-hidden rounded-xl bg-[var(--bg-surface-muted)] ring-2 transition-[box-shadow] duration-200 ${ring}`}>
          {face}
        </figure>
      )}

      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Choose tutor">
        {tutors.map((t) => {
          const isActive = t.tutor_id === activeId;
          return (
            <button
              key={t.tutor_id}
              type="button"
              aria-pressed={isActive}
              disabled={call.status === "connecting" || (inCall && (isActive || !!call.switchingTo))}
              onClick={() => (inCall ? call.switchTutor(t.tutor_id) : setPicked(t.tutor_id))}
              className={`apple-press apple-focus flex items-center gap-1.5 rounded-lg border p-1.5 text-left transition-colors ${
                isActive
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] disabled:opacity-60"
              }`}
            >
              <Portrait tutor={t} size={24} />
              <span title={t.name} className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">{t.name}</span>
              {call.switchingTo === t.tutor_id && <Loader2 className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" aria-label="switching" />}
            </button>
          );
        })}
      </div>

      {inCall ? (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void call.toggleMic()}
            aria-pressed={call.mic}
            aria-label={call.mic ? "Mute microphone" : "Unmute microphone"}
            className={`apple-press apple-focus grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors ${
              call.mic
                ? "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                : "border-[var(--status-contradict-border)] bg-[var(--status-contradict-soft)] text-[var(--status-contradict)] hover:border-[var(--status-contradict)]"
            }`}
          >
            {call.mic ? <Mic className="h-3.5 w-3.5" aria-hidden /> : <MicOff className="h-3.5 w-3.5" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              call.end();
            }}
            className="apple-press apple-focus flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--status-contradict)] text-xs font-semibold text-[var(--status-contradict-fg)] transition-opacity hover:opacity-90"
          >
            <PhoneOff className="h-3.5 w-3.5" aria-hidden /> Leave
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!picked}
          onClick={() => picked && void call.start(picked)}
          className="apple-focus flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] text-xs font-semibold text-[var(--accent-fg)] transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:opacity-50"
        >
          <Video className="h-3.5 w-3.5" aria-hidden /> Start live tutor
        </button>
      )}

      {loadError && tutors.length === 0 && (
        <p role="alert" className="flex items-center justify-between gap-2 text-[11px] text-[var(--status-contradict)]">
          <span>Couldn&apos;t reach the tutor service ({loadError}).</span>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="apple-press apple-focus shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-1 font-semibold text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          >
            Retry
          </button>
        </p>
      )}
      {call.status === "error" && <p role="alert" className="text-[11px] text-[var(--status-contradict)]">{call.error}</p>}
      {inCall && lastTutorLine && !popped && (
        <p aria-live="polite" className="line-clamp-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {lastTutorLine.text}
        </p>
      )}
    </div>
  );
}
