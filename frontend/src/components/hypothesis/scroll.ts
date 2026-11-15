/**
 * Bring `el` into view inside `box` only. `scrollIntoView` also scrolls every ancestor (the
 * page on phones, where the map and the list are stacked), which yanked the map off screen
 * whenever a node was picked on it.
 */
export function scrollIntoBox(box: HTMLElement | null | undefined, el: HTMLElement | null | undefined, margin = 8) {
  if (!box || !el) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let delta = 0;
  if (r.top < b.top + margin) delta = r.top - b.top - margin;
  else if (r.bottom > b.bottom - margin) delta = Math.min(r.bottom - b.bottom + margin, r.top - b.top - margin);
  if (!delta) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof box.scrollBy === "function") box.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
  else box.scrollTop += delta;
}
