# Phase 3 v3 — a tutor that teaches like 3Blue1Brown

Status: **plan, awaiting approval** (2026-11-14). Builds on `phase3/v2-base`. Nothing here is built yet.

## Why v3

v2 has the parts (slides, board, pen, laser, circle, watching) but the *lesson* does not work:
explanations are too fast and too hard, a circle triggers an instant lecture, follow-ups jump to a new
slide so the student loses context, the tutor forgets where it was after a detour, the laser vanishes,
captions cover the content. v3 is about teaching quality and flow, not new widgets.

## What you asked for → where it lands

| # | Requirement (your words, condensed) | Workstream |
|---|---|---|
| R1 | Teach like 3Blue1Brown: content, delivery and visuals, not just animations | WS-1, WS-5 |
| R2 | Much slower: one idea at a time, don't move on before I've understood | WS-1, WS-3, WS-4 |
| R3 | Circle stays until the tutor has asked what I don't get **and** I've told it | WS-2, WS-3, WS-4 |
| R4 | Explain **on the current slide** (edit it); new slide only if the idea isn't on the page | WS-2, WS-3 |
| R5 | Lesson memory: a **main branch** (planned lesson from my materials/syllabus) + **side branches** (detours), checkpointed every interval, always return to the main thread | WS-1 |
| R6 | Track how well I understood each concept | WS-1 |
| R7 | One consistent explanation thread: same picture/analogy within a concept, always link back | WS-1, WS-5 |
| R8 | Slower slide→board transition; equations written in slowly, by pen | WS-3, WS-4 |
| R9 | Easier material: A-level, not research-level | WS-5 |
| R10 | Every slide builds on the previous one | WS-5 |
| R11 | Laser always visible; parks where it was when the tutor just talks | WS-3, WS-4 |
| R12 | Captions: one line only | WS-4 |

## The teaching contract (how 3Blue1Brown teaches → rules the tutor follows)

From Grant Sanderson's own advice (concrete before abstract, the visual forces a concrete example,
learning comes from reconstructing the idea yourself) and the structure of his videos:

1. **Question first.** Each concept opens with a question the student can feel ("how steep is a curve
   *at one point*?"), before any definition.
2. **Concrete before abstract.** A specific example with numbers or a picture first; the general
   formula is *earned* at the end, as a name for what they already saw.
3. **One idea per step.** At most one new term or symbol per step. 2–3 short sentences, then the
   animation, then a pause.
4. **Let them predict.** Before revealing, ask "what do you think happens if…?" at least once per slide.
5. **One visual anchor per concept.** The same picture/analogy is reused for the whole concept (and
   in any detour from it). No new analogy unless the student is still stuck after two tries.
6. **Colour means something.** A quantity keeps its colour everywhere (already in the slide renderer).
7. **Bridge every slide.** Each slide starts with one sentence linking to the last ("we just saw X;
   now…") and ends with a check before moving on.
8. **Pace.** Speech ~0.9× speed, ~130 words/min, never more than ~25 s of talk without a pause or a
   question; the next slide only after the student answers the check.

These rules live in one place (the system prompt) and the deck generator uses the same list.

## Design

### A. Lesson brain — main branch, side branches, checkpoints (WS-1)
- **Main branch = the deck.** It is already an ordered, planned lesson built from the student's
  materials. Each slide gains `idea` (one sentence), `builds_on` (previous slide id) and `check`
  (the check question). No second planning artefact.
- **`LessonState`** (agent, in memory): current slide + step; a **side-branch stack**
  (`{topic, from_slide, from_step, reason}`); per-concept understanding
  (`not_yet | shaky | got_it` + evidence); the concept's chosen visual anchor; what was explained.
- **Checkpoint** after every tutor turn and every 60 s: one compact "Lesson state" system message,
  *replaced* in the chat context each time (same pattern as the rolling summary), and saved to the
  backend so the next lesson resumes from it.
- **Tools:** `detour_start(topic, why)`, `detour_end(resolved)`, `mark_understanding(concept, level,
  evidence)`. Ending a detour forces a bridge back: "So, back to <slide idea>: what we just saw means…".
- **Model:** the voice brain stays fast (Haiku). Quality comes from the pre-planned deck (idea,
  narration, check per step) plus the contract. We **measure** Sonnet 5.5 (thinking off) as the voice
  brain and switch only if first-word latency stays under ~1.5 s. Decision needed, see below.

### B. Teaching flow, circle and slide edits (WS-2)
- **Circle flow:** circle → the mark **stays** on screen → the tutor asks one short question ("What
  about this part feels unclear?") and **does not explain yet** → the student answers (voice or
  typed) → the tutor explains **on the same slide** → the circle clears only when the tutor calls
  `clear_circle` after the student confirms.
- **Edit in place:** new tool `slide_edit(brief, object_ids)`. Sonnet plans *added* objects and steps
  for the **open** slide (highlight, label, worked numbers, morph, a small extra plot) and they
  animate in. `slide_animate` (a new slide) is only for ideas that are not on the page.
- **Pacing in code:** TTS speed 0.9; `slide_step` returns only after that step's animation ends;
  the tutor waits for the check answer before `slide_go`.

### C. Slides UI (WS-3)
- `slides.edit` RPC: append objects and steps to the current slide and play them.
- The circle stays drawn (with a small "?" badge) until `ui.clear_circle`.
- **Laser always on:** never fades; stays at its last target; starts parked near the slide title.
- Equations are **written in by pen** (the same left-to-right reveal as the board), slowly.
- About 1.6× slower step animations and ~700 ms slide transitions.

### D. Board and shell UI (WS-4)
- Board pen slower (~2–3 s per line); laser always on and parked; board circle stays until cleared.
- Moving between tabs: a ~1 s cross-fade with a "Moving to the whiteboard…" label, so it never jumps.
- Captions: a **single line**, the latest words only, in a thin bar.

### E. Content (WS-5)
- **New A-level demo track: "Differentiation — the gradient of a curve".** A hand-made, checked
  deck of 6 slides, each building on the last:
  1. how fast is the car going *right now*?
  2. gradient of a straight line;
  3. a chord between two points;
  4. zoom in, and the chord becomes the tangent;
  5. the limit gives the gradient of x² as 2x;
  6. recap and practice.
  It is the main showcase; Gradient Descent stays available.
- The deck generator prompt is rewritten around the teaching contract, A-level pitch and the
  slide→slide chain (`builds_on`, `idea`, `check` are required).

## Shared contracts (Task 0, by me, before the agents start)
- Deck schema: `Slide.idea`, `Slide.builds_on`, `Slide.check` (optional in the schema, required by
  the generator).
- RPCs: `slides.edit {objects, steps}`, `ui.clear_circle {circle_id}`; `CircleEvent.circle_id`.
- Laser semantics: `point_at` / `slides.point` keep the dot shown until the next point.
- Agent extension points and tool names: `lesson_state.py` (`LessonState`, `RULES`, tools),
  `slide_edit`, `clear_circle`, `detour_start`, `detour_end`, `mark_understanding`.
- Backend: `POST/GET /api/tutor/lessons/{id}/state` (checkpoint).

## Workstreams (five agents in parallel, separate worktrees, no shared files)

| WS | Owns | Builds |
|---|---|---|
| WS-1 Lesson brain | `agent/lesson_state.py`, `agent/prompting.py`, `agent/rolling.py`, backend lesson-state endpoint + store | A |
| WS-2 Teaching flow | `agent/circle.py`, `agent/slides.py`, `agent/watch.py` | B |
| WS-3 Slides UI | `frontend/src/tutor/slides/**` except `decks/` | C |
| WS-4 Board + shell | `frontend/src/tutor/board/**`, `frontend/src/tutor/shell/**` | D |
| WS-5 Content | `backend/tutor/deck.py`, `backend/tutor/seed.py`, `frontend/src/tutor/slides/decks/**` | E |

`agent/agent.py` wiring (TTS speed, new tools, checkpoint timer) is done by me in Task 0, plus the
final integration.

## Done means (acceptance run, muted, in Chrome)
A scripted 6-minute lesson on the new A-level track, checked against:
- the tutor bridges into every slide and asks a check before moving on;
- speech is no faster than ~140 words/min and there is no talking stretch over ~25 s without a pause;
- a circle stays until the tutor asks, I answer, and it explains **on the same slide**; then it clears;
- a detour ("wait, what's a limit?") is explained, then the tutor says it's going back and returns to
  the same slide and step;
- the lesson-state checkpoint shows the detour and the understanding marks;
- the laser is visible the whole time; captions are one line; nothing crashes.

## Decisions for you
1. **Showcase topic:** "Differentiation — the gradient of a curve" (recommended), or another A-level
   topic you are studying?
2. **Voice brain:** keep Haiku (fastest) and get quality from the planned deck and the contract
   (recommended), or switch to Sonnet 5.5 if the latency test passes?

## Not in v3 (named so you can object)
Multi-lesson syllabus planning across weeks; detecting understanding from the student's tone of
voice; Safari 18.3 support (WebKit bug, use Chrome).
