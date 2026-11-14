"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { getTrack, type KP, type Lesson, type Track } from "./api";
import { AddMaterial } from "./AddMaterial";
import type { Caption } from "./session";

/** Track + lessons, refetched every 4 s while `poll` is on (the agent updates KPs during the lesson). */
export function useTrackData(trackId: string, poll: boolean) {
  const [data, setData] = useState<{ track: Track; lessons: Lesson[] }>();
  useEffect(() => {
    let alive = true;
    const load = () =>
      getTrack(trackId).then(
        (d) => alive && setData(d),
        () => {} // keep showing the last good data; the next poll retries
      );
    void load();
    const timer = poll ? setInterval(load, 4000) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [trackId, poll]);
  return [data, setData] as const;
}

const STATUS: Record<KP["status"], { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-slate-800 text-slate-400" },
  introduced: { label: "Introduced", cls: "bg-sky-500/15 text-sky-300" },
  understood: { label: "Understood", cls: "bg-emerald-500/15 text-emerald-300" },
};

export function LessonPanel({ track, lessons, lessonId }: { track: Track; lessons: Lesson[]; lessonId?: string }) {
  const kps = track.knowledge_points;
  const done = kps.filter((k) => k.status === "understood").length;
  const current = lessons.find((l) => l.lesson_id === lessonId && l.ended_at);
  const lastTime = lessons.find((l) => l.lesson_id !== lessonId && l.ended_at && l.summary);
  return (
    <div className="space-y-5">
      {current && (
        <section aria-label="Lesson recap" className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-300">This lesson</h3>
          <p className="text-sm leading-relaxed text-slate-200">{current.summary || "No summary yet."}</p>
          {current.struggles.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              To practise: {current.struggles.map((s) => s.what).join("; ")}
            </p>
          )}
        </section>
      )}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Knowledge points</h3>
          <span className="text-[11px] tabular-nums text-slate-500">
            {done}/{kps.length} understood
          </span>
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-500 ease-out"
            style={{ width: `${kps.length ? (done / kps.length) * 100 : 0}%` }}
          />
        </div>
        {kps.length === 0 ? (
          <p className="text-xs text-slate-500">No knowledge points yet. Add material to this track.</p>
        ) : (
          <ul className="space-y-1.5">
            {kps.map((k) => (
              <li key={k.kp_id} className="flex items-start justify-between gap-2 rounded-lg px-1 py-1">
                <span className="text-sm text-slate-200">{k.title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[k.status].cls}`}>
                  {STATUS[k.status].label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {lastTime && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Last time</h3>
          <p className="text-sm leading-relaxed text-slate-300">{lastTime.summary}</p>
        </section>
      )}
    </div>
  );
}

function Transcript({ captions, tutorName }: { captions: Caption[]; tutorName: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [captions]);
  if (!captions.length) return <p className="text-xs text-slate-500">The conversation will appear here.</p>;
  return (
    <>
    <ol className="space-y-3">
      {captions.map((c) => (
        <li key={c.id}>
          <div className={`text-[11px] font-semibold ${c.who === "tutor" ? "text-sky-300" : "text-amber-300"}`}>
            {c.who === "tutor" ? tutorName : "You"}
          </div>
          <p className={`text-sm leading-relaxed ${c.final ? "text-slate-200" : "text-slate-400"}`}>{c.text}</p>
        </li>
      ))}
    </ol>
    <div ref={end} />
    </>
  );
}

const TABS = ["Transcript", "Lesson", "Materials"] as const;

export function SidePanel({
  trackId,
  lessonId,
  live,
  captions,
  tutorName,
}: {
  trackId: string;
  lessonId?: string;
  live: boolean;
  captions: Caption[];
  tutorName: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Transcript");
  const [data, setData] = useTrackData(trackId, live);
  return (
    <section aria-label="Side panel" className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-800 bg-slate-900/60">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-slate-800 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              tab === t ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "Transcript" && <Transcript captions={captions} tutorName={tutorName} />}
        {tab === "Lesson" &&
          (data ? <LessonPanel {...data} lessonId={lessonId} /> : <p className="text-xs text-slate-500">Loading…</p>)}
        {tab === "Materials" && (
          <div className="space-y-4">
            <ul className="space-y-1.5">
              {data?.track.materials.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-200">
                  {m.kind === "url" ? (
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                  )}
                  <span className="truncate" title={m.ref}>
                    {m.dataset_title || m.ref}
                  </span>
                </li>
              ))}
              {data && !data.track.materials.length && <li className="text-xs text-slate-500">No materials yet.</li>}
            </ul>
            <AddMaterial trackId={trackId} onAdded={(track) => setData((d) => (d ? { ...d, track } : d))} />
          </div>
        )}
      </div>
    </section>
  );
}
