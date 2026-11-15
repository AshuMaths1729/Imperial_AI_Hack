// Pure timing and CSS for the tutor's pen: writing is revealed line by line, left to right (no pen icon).

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** ms to write one line of `chars` characters at speaking pace (~20 characters ≈ 4 s), 1.5–8 s a line. */
export const lineMs = (chars: number) => clamp(Math.round(chars * 200), 1500, 8000);

/** Total writing time for `chars` characters spread over `lines` rendered lines. */
export const writeMs = (chars: number, lines: number) => lines * lineMs(chars / Math.max(1, lines));

/** Rough visible-glyph count of a LaTeX string (commands and braces aren't written). */
export const latexChars = (latex: string) => latex.replace(/\\[a-zA-Z]+|[{}^_\s]/g, "").length + (latex.match(/\\[a-zA-Z]+/g)?.length ?? 0);

/** Pause between strokes, as the pen lifts and moves. */
export const PEN_LIFT_MS = 120;

/**
 * Pen clock: writes queue one after another. Returns when this write starts (ms from now) and
 * the new time the pen is free (absolute).
 */
export function schedule(now: number, penFreeAt: number, durationMs: number): { delay: number; freeAt: number } {
  const start = Math.max(now, penFreeAt);
  return { delay: start - now, freeAt: start + durationMs + PEN_LIFT_MS };
}

const pct = (v: number) => `${+v.toFixed(3)}%`;

/** @keyframes body for an n-line reveal: rows above fully shown, the current row up to the (invisible) pen. */
export function writeKeyframes(n: number): string {
  const clip: string[] = [];
  const ease = "animation-timing-function: cubic-bezier(.35,.05,.6,1)";
  for (let i = 0; i < n; i++) {
    // Edge rows extend past the box so glyph overhangs aren't cut while writing.
    const top = i === 0 ? -30 : (i / n) * 100, bottom = i === n - 1 ? 130 : ((i + 1) / n) * 100;
    const poly = (p: number) => `polygon(-5% -30%, 105% -30%, 105% ${pct(top)}, ${pct(p)} ${pct(top)}, ${pct(p)} ${pct(bottom)}, -5% ${pct(bottom)})`;
    const t0 = (i / n) * 100, t1 = ((i + 1) / n) * 100;
    // Two keyframes per row; the pen jumps to the next row's start right after the previous one ends.
    clip.push(`${pct(i ? t0 + 0.001 : t0)} { clip-path: ${poly(-5)}; ${ease} }`, `${pct(t1)} { clip-path: ${poly(105)} }`);
  }
  return clip.join(" ");
}
