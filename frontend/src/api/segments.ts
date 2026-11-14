/**
 * Speak `Segment`s in order and fire each segment's `ui_annotations` as it starts, so speech and
 * graphics stay in sync regardless of the voice/avatar implementation.
 */
import { isAbortError, resolveMediaUrl } from "./client";
import { tts } from "./endpoints";
import type { Segment } from "./types";

/** Speak `text`; resolve when finished. Must reject with an AbortError when `signal` aborts. */
export type SpeakFn = (text: string, signal?: AbortSignal) => Promise<void>;

export interface PlaySegmentsOptions {
  /** Called right before a segment is spoken: fire its `ui_annotations` here. */
  onSegmentStart?: (segment: Segment, index: number) => void;
  onSegmentEnd?: (segment: Segment, index: number) => void;
  /** A speak failure (not an abort) does not stop playback; the next segment still plays. */
  onError?: (error: unknown, segment: Segment, index: number) => void;
  signal?: AbortSignal;
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

/** Resolves `true` when every segment played, `false` if aborted part-way. */
export async function playSegments(
  segments: Segment[],
  speakFn: SpeakFn,
  { onSegmentStart, onSegmentEnd, onError, signal }: PlaySegmentsOptions = {},
): Promise<boolean> {
  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) return false;
    const seg = segments[i];
    onSegmentStart?.(seg, i);
    try {
      await speakFn(seg.text, signal);
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) return false;
      onError?.(e, seg, i);
    }
    onSegmentEnd?.(seg, i);
  }
  return !signal?.aborted;
}

/** Browser `speechSynthesis`. With no synth available, waits a reading-time estimate instead. */
export function speakWithBrowser(text: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => {
      synth?.cancel();
      finish(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      const ms = Math.max(600, text.split(/\s+/).length * 330);
      const t = setTimeout(() => finish(), ms);
      signal?.addEventListener("abort", () => clearTimeout(t), { once: true });
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => finish();
    u.onerror = (ev) =>
      ev.error === "canceled" || ev.error === "interrupted"
        ? finish()
        : finish(new Error(`speechSynthesis: ${ev.error}`));
    synth.speak(u);
  });
}

/** Backend TTS (`POST /tts`) played through an `HTMLAudioElement`. */
export async function speakWithBackend(text: string, signal?: AbortSignal): Promise<void> {
  const { url } = await tts(text, { signal });
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const audio = new Audio(resolveMediaUrl(url));
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      audio.pause();
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    audio.onended = () => {
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("audio playback failed"));
    };
    audio.play().catch((e) => {
      cleanup();
      reject(e);
    });
  });
}
