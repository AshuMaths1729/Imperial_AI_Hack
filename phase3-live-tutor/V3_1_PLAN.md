# Phase 3 v3.1 — polish pass from the student's walkthrough

Status: approved to execute (2026-11-15). Builds on `phase3/v3-base`.

## What the student found → fix

| # | Finding | Fix | WS |
|---|---|---|---|
| F1 | Laser doesn't follow what he says ("rise over run" should move from rise to run as he says it) | **Speech-synced laser**: the tutor tags words with object ids in its speech (`the [[rise]] rise over the [[run]] run`); the agent strips the tags before speech and sends a cue script; the page moves the laser when that word is spoken (captions are word-synced to the audio) | A + D |
| F2 | The circle stays after he starts answering | The circle clears **when the explanation starts** (after the student has said what's unclear), not after "did that help?" | A + B |
| F3 | After explaining on the whiteboard and going back to the slides, the stage stays on the whiteboard | Fix the tab switch back to slides (reproduce, root-cause, test) | D |
| F4 | Pen icon on slides and board | Remove the pen tip everywhere; text/equations are written in (no icon) | B + C |
| F5 | Writing is much faster than speech | Write at speaking pace (~20 characters ≈ 4 s; min 1.5 s per item) | B + C |
| F6 | On the board: explaining while writing is confusing | **Write first, then explain**: write the working (one short sentence while it writes), then explain line by line with the laser on each part | A |
| F7 | Board equations/numbers should look handwritten; strokes should feel natural | Board maths in a handwriting style (handwriting font for digits/letters, stroke-like left-to-right reveal); true stroke drawing if it can be done robustly | C |
| F8 | Pace still slightly too fast | Speech 0.85×; 1–2 short sentences per step; a beat of silence after each reveal | A |
| F9 | Checker said "your working" when only "ANS = 4" was written | The handwriting checker describes only what is literally on the board | A |
| F10 | Laser has a ring/shadow overlapping the dot; too big | One small solid red dot with a soft glow, no ring — same look on slides and board | B + C |
| F11 | Voice is jarring | Calmer ElevenLabs voices: Eric (main), Chris, Bill — done in Task 0 | 0 |
| F12 | Lesson UI: transcript shouldn't be a main feature | Side panel becomes **Key points · Check yourself · Materials**; transcript only as "Download transcript" (any time / at the end) | D |
| F13 | Timer, progress and mastery like the ScholarTwin workspace design | Header with a live lesson timer, a lesson progress bar (ideas covered / total) and mastery (% understood), styled like the team's workspace (light glass panels, green accent, mono labels) | D |

## Contracts (Task 0)
- RPC **`ui.point_cues`** `{cues: [{word: int, id: string}]}` (agent → page): `word` is the 0-based index of a word in
  the tutor speech that starts right after this RPC (counting tutor caption words that arrive after it). The page points
  at `id` on the active stage when that word is spoken: Slides → `slides.point(id)`; Whiteboard → board `point_at`.
- Tag syntax in the tutor's text: `[[object_id]]` immediately before the word(s) it points at. Never spoken, never captioned.
- Lesson state for the UI: `GET /api/tutor/lessons/{id}/state` (exists) + the deck and track KP statuses (exist).
- Laser look (slides and board): solid red dot ~12 px, soft glow, no outline ring; glides ~450 ms; always visible.

## Workstreams (parallel, separate worktrees, no shared files)
| WS | Owns | Fixes |
|---|---|---|
| A — Tutor brain | `agent/**` (incl. `agent.py`) | F1 (tags → cue script), F2, F6, F8, F9 |
| B — Slides | `frontend/src/tutor/slides/**` | F2 (page side), F4, F5, F10 |
| C — Whiteboard | `frontend/src/tutor/board/**` | F4, F5, F7, F10 |
| D — Lesson UI | `frontend/src/tutor/shell/**`, `frontend/src/app/tutor/**` | F1 (cue scheduling), F3, F12, F13 |

## Done means
All suites green; a muted live run shows: the laser moves to the tagged object as the word is spoken; the circle
clears as the explanation begins; board explanations write first and then point; no pen icon; writing at speaking
pace; whiteboard → slides switches back; new side panel, timer, progress and mastery; transcript download works.
