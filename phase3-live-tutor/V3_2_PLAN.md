# Phase 3 v3.2 — laser, explanation pop-up, clear speech, real PDFs

Status: approved to execute (2026-11-15). Builds on `phase3/v3-base`.

## Findings → fixes

| # | Finding | Fix | WS |
|---|---|---|---|
| G1 | **Most important:** the laser doesn't move along with what's being said; only numbers get pointed at | Denser tags (every sentence about something on screen, including lines, curves, arrows, axes); pointing at a line/curve **traces along it**; rise/run segments each light up; the pointed object gets a soft highlight; when a step plays with no tag, the page points at that step's main object automatically | A, B, C |
| G2 | In-slide explanations overlap content and look cluttered | Explanation **pop-up**: its own small animated slide in a card; the main slide is untouched (only the circled part is highlighted); closes when the student has understood. Two placements to try, toggled in the UI: **stage bottom-right** (default) or **side panel** | A, B, D |
| G3 | Slide text writes in too slowly (writing belongs on the whiteboard) | Slides: text and equations appear almost instantly (short ~250 ms fade/wipe); handwriting stays on the whiteboard only | B |
| G4 | Slide 5 "the limit": the two points collapse but you can't see it | A zoomed-in inset around P: its own small axes and labels, P and Q, the chord, and **h** labelled as the gap, shrinking | B |
| G5 | Voice stutters / garbles maths | **Measured:** both ElevenLabs Flash and Turbo garble symbols ("(3, 9)" → mumbling, "PQ" → "P U two into", "m/s" → "mils", "0.001" → "0.01"); the same sentences written as words transcribe perfectly. Fix: a maths-to-speech normaliser before TTS (numbers, decimals, coordinates, fractions, powers, dy/dx, units, letter names) plus a rule to speak maths in words | A |
| G6 | Whiteboard: write a line, explain it, then the next line | One line per board_write, then explain it with the laser, then write the next (all visible, no hidden steps) | A |
| G7 | Does PDF upload make a lesson? **Partly:** the team ingest keeps only each page's first lines (first 6 pages) and the deck generator sees only titles/headings | New `POST /api/tutor/tracks/{id}/materials/pdf`: full text extracted and stored, KPs and the deck generated from the full text; the Materials tab uses it | E, D |

## Contracts (Task 0, in `phase3/v3-base`)
- `SlidesHandle.explain(slide)`, `.explainStep(n)`, `.closeExplanation()`; RPCs `slides.explain {slide}` (a deck-schema
  Slide), `slides.explain_step {step}` (reply carries `ms`), `slides.explain_close {}`.
- `SlidesStage` prop `explanationSlot?: HTMLElement | null` — the shell passes a side-panel element to dock the pop-up
  there; null = stage bottom-right.
- Laser cues (`ui.point_cues`) unchanged; tracing/highlighting is page-side behaviour of `point(id)`.
- PDF endpoint: `POST /api/tutor/tracks/{id}/materials/pdf` (multipart `file`) → the updated Track.

## Workstreams
| WS | Owns | Fixes |
|---|---|---|
| A — Tutor brain | `agent/**` | G1 (tags), G2 (tools), G5, G6 |
| B — Slides | `frontend/src/tutor/slides/**` incl. decks | G1 (trace/highlight/auto-point), G2 (pop-up), G3, G4 |
| C — Whiteboard | `frontend/src/tutor/board/**` | G1 on the board (trace along a line, highlight) |
| D — Lesson UI | `frontend/src/tutor/shell/**`, `frontend/src/app/tutor/**` | G2 placement toggle + side-panel slot, G7 upload UI |
| E — Backend | `backend/tutor/**` | G7 |

## Done means
All suites green; muted live run: the laser moves at least once per sentence about the screen, traces lines,
lights up rise then run; a circle opens a pop-up explanation (both placements work) that closes when understood;
slide text appears almost instantly; slide 5 shows the zoom inset with h; maths is spoken cleanly
(normaliser verified with the TTS→STT round-trip); board writes one line then explains it; a PDF upload yields KPs
and a deck built from its text.
