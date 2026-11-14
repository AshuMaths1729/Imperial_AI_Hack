"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video } from "lucide-react";
import { listTutors, type Tutor } from "./api";
import { AvatarVideo, Portrait, portrait } from "./media";
import { useAvatarCall } from "./useAvatarCall";

/** Live tutor in the workspace's avatar dock: portrait when idle, the Synthesia video in a call, pop-out to 512 px. */
export function LiveAvatarTile() {
  const call = useAvatarCall();
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
        <p role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-slate-100">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {active?.name ?? "Tutor"} is joining…
        </p>
      ) : null}
      <span className="absolute left-2 top-2 rounded-md bg-slate-950/70 px-2 py-0.5 text-[10px] font-medium text-slate-100 backdrop-blur">
        {active ? `${active.name} · ${active.tagline}` : "Live tutor"}
        {call.tutorSpeaking && <span className="ml-1 text-sky-300">· speaking</span>}
      </span>
      {call.avatarVideo && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={popped ? "Shrink tutor window" : "Expand tutor window"}
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-slate-950/70 text-slate-200 backdrop-blur transition-colors hover:bg-slate-800"
        >
          {popped ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
        </button>
      )}
    </>
  );

  const ring = call.tutorSpeaking ? "ring-sky-400" : "ring-slate-800";

  return (
    <div className="w-full space-y-3">
      {popped ? (
        <>
          <div className="grid aspect-square w-full place-items-center rounded-xl bg-slate-900 text-[11px] text-slate-500 ring-1 ring-slate-800">
            Showing in the large window
          </div>
          <figure className={`fixed left-[306px] top-[72px] z-40 aspect-square w-[512px] max-w-[calc(100vw-322px)] overflow-hidden rounded-2xl bg-slate-900 shadow-2xl shadow-black/60 ring-2 ${ring}`}>
            {face}
            {lastTutorLine && (
              <figcaption aria-live="polite" className="absolute inset-x-3 bottom-3 rounded-lg bg-slate-950/75 p-2.5 text-xs leading-relaxed text-slate-100 backdrop-blur">
                {lastTutorLine.text}
              </figcaption>
            )}
          </figure>
        </>
      ) : (
        <figure className={`relative aspect-square w-full overflow-hidden rounded-xl bg-slate-900 ring-2 transition-[box-shadow] duration-200 ${ring}`}>
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
              className={`flex items-center gap-1.5 rounded-lg border p-1.5 text-left transition-colors ${
                isActive ? "border-sky-400 bg-sky-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-600 disabled:opacity-60"
              }`}
            >
              <Portrait tutor={t} size={24} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-200">{t.name}</span>
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
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
              call.mic ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
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
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-600 text-xs font-semibold text-white transition-colors hover:bg-rose-500"
          >
            <PhoneOff className="h-3.5 w-3.5" aria-hidden /> Leave
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!picked}
          onClick={() => picked && void call.start(picked)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500 text-xs font-semibold text-slate-950 transition-[transform,background-color] duration-150 ease-out hover:bg-sky-400 active:scale-[0.98] disabled:opacity-50"
        >
          <Video className="h-3.5 w-3.5" aria-hidden /> Start live tutor
        </button>
      )}

      {loadError && tutors.length === 0 && (
        <p role="alert" className="flex items-center justify-between gap-2 text-[11px] text-rose-400">
          <span>Couldn&apos;t reach the tutor service ({loadError}).</span>
          <button type="button" onClick={() => setAttempt((a) => a + 1)} className="shrink-0 rounded-md bg-slate-800 px-2 py-1 font-semibold text-slate-200 hover:bg-slate-700">
            Retry
          </button>
        </p>
      )}
      {call.status === "error" && <p role="alert" className="text-[11px] text-rose-400">{call.error}</p>}
      {inCall && lastTutorLine && !popped && (
        <p aria-live="polite" className="line-clamp-3 text-[11px] leading-relaxed text-slate-300">
          {lastTutorLine.text}
        </p>
      )}
    </div>
  );
}
