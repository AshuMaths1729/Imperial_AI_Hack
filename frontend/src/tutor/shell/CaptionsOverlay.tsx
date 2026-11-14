import type { Caption } from "./session";

/** Last two caption lines over the stage, like Zoom's CC. */
export function CaptionsOverlay({ captions, tutorName }: { captions: Caption[]; tutorName: string }) {
  const last = captions.slice(-2);
  if (!last.length) return null;
  return (
    <div
      data-testid="captions-overlay"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4"
    >
      <div className="max-w-2xl space-y-1 rounded-xl bg-slate-950/80 px-4 py-2.5 text-[15px] leading-snug shadow-lg backdrop-blur">
        {last.map((c) => (
          <p key={c.id} className={c.final ? "text-slate-50" : "text-slate-300"}>
            <span className={`mr-2 text-xs font-semibold ${c.who === "tutor" ? "text-sky-300" : "text-amber-300"}`}>
              {c.who === "tutor" ? tutorName : "You"}
            </span>
            {c.text}
          </p>
        ))}
      </div>
    </div>
  );
}
