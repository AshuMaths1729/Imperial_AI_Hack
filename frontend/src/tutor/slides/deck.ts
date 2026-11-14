// Deck navigation (which slide, which step), follow-up slides pushed by the agent, and the outline the agent reads.
// Indexes the agent sees are 1-based ("slide 1"); `index` in DeckState is 0-based.
import { stateAt, stepCount } from "./scene";
import type { Slide, SlideObject, SlidesDescription } from "./types";

export type DeckState = { slides: Slide[]; followups: string[]; index: number; step: number };
export type Result = { state: DeckState; errors: string[] };

export const emptyDeck = (slides: Slide[] = []): DeckState => ({ slides, followups: [], index: 0, step: 0 });

const fail = (state: DeckState, msg: string): Result => ({ state, errors: [msg] });

/** Opens slide `n` (1-based) at step 0. */
export function goTo(st: DeckState, n: number): Result {
  if (!st.slides.length) return fail(st, "no slides are loaded");
  if (!Number.isInteger(n) || n < 1 || n > st.slides.length) return fail(st, `slide must be 1..${st.slides.length}`);
  return { state: { ...st, index: n - 1, step: 0 }, errors: [] };
}

/** Shows the open slide as it is after `step` steps (animating when it is the next one). */
export function stepTo(st: DeckState, step: number): Result {
  const slide = st.slides[st.index];
  if (!slide) return fail(st, "no slides are loaded");
  const max = stepCount(slide);
  if (!Number.isInteger(step) || step < 0 || step > max) return fail(st, `step must be 0..${max} on this slide`);
  return { state: { ...st, step }, errors: [] };
}

const KIND_REFS: Partial<Record<SlideObject["kind"], [string, SlideObject["kind"]][]>> = {
  curve: [["axes", "axes"]],
  dot: [["axes", "axes"], ["curve", "curve"]],
  tangent: [["curve", "curve"], ["dot", "dot"]],
  step_arrow: [["dot", "dot"]],
  text: [["axes", "axes"]],
  math: [["axes", "axes"]],
  polyline: [["axes", "axes"]],
  vector: [["axes", "axes"]],
  shape: [["axes", "axes"]],
};

/** Cross-reference checks for a slide from the agent (backend/tutor/deck.py slide_errors is the full version). */
export function slideErrors(raw: unknown): string[] {
  const s = raw as Slide;
  if (!s || typeof s !== "object" || typeof s.id !== "string" || typeof s.title !== "string" || !Array.isArray(s.objects))
    return ["slide needs id, title and objects"];
  const errs: string[] = [];
  const byId = new Map<string, SlideObject>();
  for (const o of s.objects) {
    if (!o || typeof o.id !== "string" || typeof o.kind !== "string") {
      errs.push("every object needs an id and a kind");
      continue;
    }
    if (byId.has(o.id)) errs.push(`duplicate object id ${o.id}`);
    byId.set(o.id, o);
  }
  for (const o of byId.values()) {
    for (const [field, kind] of KIND_REFS[o.kind] ?? []) {
      const ref = (o as Record<string, unknown>)[field];
      if (ref == null) continue;
      if (byId.get(String(ref))?.kind !== kind) errs.push(`${o.id}.${field} refers to ${ref}, which is not a ${kind}`);
    }
  }
  for (const [i, step] of (s.steps ?? []).entries()) {
    if (typeof step?.narration !== "string" || !Array.isArray(step.actions)) {
      errs.push(`step ${i + 1} needs narration text and a list of actions`);
      continue;
    }
    for (const a of step.actions) {
      if (!a || typeof a !== "object" || typeof a.do !== "string") {
        errs.push(`step ${i + 1}: every action needs a "do"`);
        continue;
      }
      const ids = "ids" in a ? a.ids : [a.id];
      for (const id of ids ?? []) if (!byId.has(id)) errs.push(`step ${i + 1} ${a.do}: unknown object ${id}`);
      if ((a.do === "move" || a.do === "path") && byId.get(a.id) && byId.get(a.id)!.kind !== "dot") errs.push(`step ${i + 1}: ${a.id} is not a dot`);
    }
  }
  return errs;
}

/** Inserts an agent-made slide after the open one and opens it. A clashing id gets a suffix. */
export function pushSlide(st: DeckState, raw: unknown): Result {
  const errors = slideErrors(raw);
  if (errors.length) return { state: st, errors };
  const slide = { ...(raw as Slide) };
  const ids = new Set(st.slides.map((s) => s.id));
  for (let i = 2; ids.has(slide.id); i++) slide.id = `${(raw as Slide).id}-${i}`;
  const at = st.slides.length ? st.index + 1 : 0;
  const slides = [...st.slides.slice(0, at), slide, ...st.slides.slice(at)];
  return { state: { slides, followups: [...st.followups, slide.id], index: at, step: 0 }, errors: [] };
}

/**
 * Adds objects and steps to the OPEN slide (explain in place). The new steps go right after the current step (later
 * steps are renumbered) and are not played: the tutor plays `newSteps` with stepTo. What is on screen now does not
 * change; objects no step shows appear at once.
 */
export function editSlide(st: DeckState, patch: { objects?: unknown; steps?: unknown }): Result & { newSteps: number[] } {
  const no = (...errors: string[]) => ({ state: st, errors, newSteps: [] });
  const slide = st.slides[st.index];
  if (!slide) return no("no slides are loaded");
  const objects = patch.objects ?? [], steps = patch.steps ?? [];
  if (!Array.isArray(objects) || !Array.isArray(steps)) return no("objects and steps must be lists");
  if (!objects.length && !steps.length) return no("nothing to add: give new objects and/or steps");
  const old = new Set(slide.objects.map((o) => o.id));
  const reused = objects.filter((o) => old.has(o?.id)).map((o) => `${o.id} is already on this slide; new objects need new ids`);
  if (reused.length) return no(...reused);
  const old_steps = slide.steps ?? [];
  const merged: Slide = { ...slide, objects: [...slide.objects, ...objects], steps: [...old_steps.slice(0, st.step), ...steps, ...old_steps.slice(st.step)] };
  const errors = slideErrors(merged);
  if (errors.length) return no(...errors);
  // An object visible from the start would turn hidden until its new "show" step: that would change what is on screen.
  const fromStart = stateAt(slide, 0).visible;
  for (const [i, step] of (steps as { actions: { do: string; ids?: string[] }[] }[]).entries())
    for (const a of step.actions)
      for (const id of a.do === "show" ? (a.ids ?? []) : [])
        if (fromStart.has(id)) errors.push(`step ${st.step + i + 1} show: ${id} is on screen from the start; use indicate to point it out`);
  if (errors.length) return no(...errors);
  const slides = st.slides.map((s, i) => (i === st.index ? merged : s));
  return { state: { ...st, slides }, errors: [], newSteps: steps.map((_, i) => st.step + i + 1) };
}

const label = (o: SlideObject): string | undefined => {
  const l = "label" in o && o.label ? o.label : o.kind === "text" ? o.text : o.kind === "math" ? o.latex : undefined;
  return l && l.length > 60 ? `${l.slice(0, 59)}…` : l;
};

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** The agent's view of the deck; trimmed to fit the RPC reply limit. */
export function describeDeck(st: DeckState, limit = 14000): SlidesDescription {
  const cur = st.slides[st.index];
  const d: SlidesDescription = {
    ok: true,
    index: st.slides.length ? st.index + 1 : 0,
    step: st.step,
    slides: st.slides.map((s, i) => ({
      index: i + 1,
      id: s.id,
      title: s.title,
      kp_ids: s.kp_ids ?? [],
      steps: stepCount(s),
      ...(st.followups.includes(s.id) ? { followup: true } : {}),
    })),
    current: cur
      ? {
          id: cur.id,
          title: cur.title,
          ...(cur.idea ? { idea: cur.idea } : {}),
          ...(cur.check ? { check: cur.check } : {}),
          objects: cur.objects.map((o) => ({ id: o.id, kind: o.kind, ...(label(o) ? { label: label(o) } : {}) })),
          narration: (cur.steps ?? []).map((s) => s.narration),
        }
      : null,
  };
  if (d.current && bytes(d) > limit) d.current.objects = d.current.objects.map(({ id, kind }) => ({ id, kind }));
  while (d.current && bytes(d) > limit && d.current.narration.some((n) => n.length > 80))
    d.current.narration = d.current.narration.map((n) => n.slice(0, 80));
  while (bytes(d) > limit && d.slides.length > 1) d.slides.splice(d.slides.findIndex((s) => s.index !== d.index), 1);
  return d;
}
