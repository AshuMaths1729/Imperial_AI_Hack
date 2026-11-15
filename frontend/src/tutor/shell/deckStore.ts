"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DeckView } from "@/tutor/slides/types";
import { getDeck, prepareDeck } from "./api";

/**
 * One shared view of each track's slides (status + deck), so the lobby's Start button, the materials panel and the
 * live lesson all see the same thing. It polls while the slides are generating and stops when nobody is watching.
 */
export type DeckState = { view: DeckView | null; err?: string; uploading?: boolean };

const POLL_MS = 3000;
const EMPTY: DeckState = { view: null };

type Entry = { state: DeckState; subs: Set<() => void>; timer?: ReturnType<typeof setTimeout>; seq: number };
const entries = new Map<string, Entry>();

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

function set(id: string, state: DeckState) {
  const e = entries.get(id);
  if (!e) return;
  e.state = { ...state, uploading: e.state.uploading };
  e.subs.forEach((f) => f());
  clearTimeout(e.timer);
  e.timer = state.view?.status === "generating" ? setTimeout(() => void refreshDeck(id), POLL_MS) : undefined;
}

/** Material is on its way up for this track: hold the lesson until the server has it (and starts the slides). */
export function setUploading(id: string, on: boolean): void {
  const e = entries.get(id);
  if (!e || !!e.state.uploading === on) return;
  e.state = { ...e.state, uploading: on };
  e.subs.forEach((f) => f());
}

/** Re-reads a track's slides (e.g. right after an upload started building them). */
export async function refreshDeck(id: string): Promise<void> {
  const e = entries.get(id);
  if (!e) return;
  const seq = ++e.seq;
  try {
    const view = await getDeck(id);
    if (entries.get(id) === e && seq === e.seq) set(id, { view });
  } catch (err) {
    if (entries.get(id) === e && seq === e.seq) set(id, { view: e.state.view, err: `Couldn't check slides (${describe(err)}).` });
  }
}

/** Starts (re)building a track's slides; the shared view turns to "generating" and polls until they're ready. */
export async function rebuildDeck(id: string): Promise<void> {
  const e = entries.get(id);
  if (!e) return;
  const seq = ++e.seq;
  try {
    const view = await prepareDeck(id);
    if (entries.get(id) === e && seq === e.seq) set(id, { view });
  } catch (err) {
    if (entries.get(id) === e && seq === e.seq) set(id, { view: e.state.view, err: `Couldn't start generating slides (${describe(err)}).` });
  }
}

function subscribe(id: string, f: () => void) {
  let e = entries.get(id);
  if (!e) {
    e = { state: EMPTY, subs: new Set(), seq: 0 };
    entries.set(id, e);
  }
  e.subs.add(f);
  if (e.subs.size === 1) void refreshDeck(id);
  return () => {
    const cur = entries.get(id);
    if (!cur) return;
    cur.subs.delete(f);
    if (cur.subs.size === 0) {
      clearTimeout(cur.timer);
      entries.delete(id); // a later watcher starts fresh (and tests stay independent)
    }
  };
}

/** The track's slides, kept current. `id` "" (no track) is always empty. */
export function useDeck(id: string): DeckState {
  const sub = useCallback((f: () => void) => (id ? subscribe(id, f) : () => {}), [id]);
  const get = useCallback(() => (id ? entries.get(id)?.state ?? EMPTY : EMPTY), [id]);
  return useSyncExternalStore(sub, get, () => EMPTY);
}

/**
 * Whether a lesson can start yet. Only slides that are being built hold it back (they must be on the stage when the
 * lesson opens); a topic with no slides, or whose build failed, starts as before and the tutor uses the whiteboard.
 * `note` is what to tell the student either way.
 */
export type DeckReadiness = {
  ready: boolean;
  why: "ready" | "checking" | "generating" | "none" | "failed";
  note?: string;
};

export function deckReadiness({ view, err, uploading }: DeckState, materials: number): DeckReadiness {
  if (uploading) return { ready: false, why: "generating", note: "Uploading your material. The slides build from it next." };
  if (view?.status === "generating")
    return { ready: false, why: "generating", note: "Preparing your slides. This takes a minute or two; the lesson opens with them once they're ready." };
  if (view?.deck) return { ready: true, why: "ready" };
  if (!view && !err) return { ready: false, why: "checking", note: "Checking the slides…" };
  if (!view) return { ready: true, why: "failed", note: `${err} The lesson can still start on the whiteboard.` };
  if (view.status === "failed")
    return { ready: true, why: "failed", note: `Couldn't build the slides (${view.error || "unknown error"}). Try again, or start on the whiteboard.` };
  if (err) return { ready: true, why: "failed", note: `${err} The lesson can still start on the whiteboard.` };
  if (materials > 0) return { ready: false, why: "checking", note: "Checking the slides…" }; // the lobby starts building them
  return { ready: true, why: "none", note: "No slides for this topic yet: the tutor teaches on the whiteboard. Add a PDF or a paper's URL to get slides." };
}
