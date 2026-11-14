# Phase 3 v2 — the tutor feels like a real tutor

Approved in chat on 2026-11-14. Builds on `phase3/base` (the working MVP). Separate from the team's
`implementation_guide.md`, like the rest of `phase3-live-tutor/`.

## Why

A 5–6 minute live showcase where the AI tutor behaves like a great human tutor: it teaches through
beautiful animated slides, works problems by hand on a shared whiteboard, watches what the student
writes, and reacts to circles and mistakes, with as little latency as possible. It does not need to
run for an hour; it must run smoothly for one showcase lesson.

## Showcase script (what "done" looks like)

1. Student joins. Kenji greets and opens the **Slides** tab: an animated, intuition-first deck built
   from the track's materials (gradient descent demo). He talks through 2–3 slides; a **laser dot**
   moves to whatever he is talking about; steps animate in as he speaks.
2. Student **circles** part of a slide → Kenji generates a richer animation for it (circled slide
   content) — or, if it is a derivation, switches to the **whiteboard** and works it by hand.
3. Student pastes a question onto the whiteboard. Kenji works it with them, **writing with a pen**
   (strokes appear as if handwritten); the **camera follows the pen** and zooms to keep the working
   readable; working **stacks down the page**.
4. Student starts writing an answer, stops → after a pause Kenji gives a **hint**. Student writes a
   wrong line → Kenji **circles the mistake in red**, writes the correction **beneath it**, explains.

## Models per job

| Job | Model | Why |
|---|---|---|
| Voice brain (talk, board ops, slide driving) | `claude-haiku-5-5` (existing) | lowest latency |
| Checking the student's handwriting after a pause | `claude-haiku-5-5` + image, forced tool call | ~1–2 s, runs off the voice path |
| Deck generation (before the lesson) | `claude-sonnet-5-5` | quality; not latency-bound |
| On-demand animation for a circled slide | `claude-sonnet-5-5` (existing animate worker pattern) | background, few seconds |

## Shared contracts (landed in Task 0 on `phase3/v2-base` — change only by asking the coordinator)

- **Board size:** x 0–1000, **y 0–3000**. The page grows downward like paper.
- **New board ops** (`frontend/src/tutor/contracts/board_ops.schema.json` + `types.ts`):
  - `point_at {target_id, hold_ms?}` — laser pointer; ephemeral, never stored, not in `describe`.
  - `annotate {id?, mark: circle|underline|cross|tick, target_id? | region?, color?}` — hand-drawn mark
    (e.g. red circle around the student's wrong line). Stored as a tutor item; may target student items.
  - `focus {target_id? | region?}` — move/zoom the camera there.
  - Tutor writes (`write_math`, `write_text`) animate **as pen strokes** by default; no op change.
- **Board plugins:** `Whiteboard` takes `plugins: BoardPlugin[]` and `emit(topic, payload)`;
  `BOARD_PLUGINS` in `board/plugins/index.ts` is mounted in the live lesson. A plugin gets
  `{editor, emit, snapshot, describe}` and returns its cleanup. `useTutorSession().sendEvent(topic, payload)`
  sends JSON on a LiveKit text stream.
- **`tutor.idle` text stream:** `IdleEvent {png_b64, mime, region, item_ids, idle_ms}` — the student's
  recent ink region, sent when they wrote and then stopped.
- **`tutor.circle`:** `CircleEvent.source` adds `"slide"` (+ `slide_id`).
- **Agent extension points:** `agent/watch.py` (`RULES`, `handle_idle(agent, session, tools, payload)`,
  wired to `tutor.idle`), `agent/slides.py` (`RULES`, `slide_tools(io, lesson_id)` appended to the tool
  list). `prompting.build_instructions` appends each module's `RULES`.
- **Tool names other workstreams may reference in prompts:** `show_tab(tab: "board"|"slides")`,
  `slide_go(index)`, `slide_step(step)`, `slide_point(object_id)` (WS-C implements all four).

## Workstreams and file ownership (no two touch the same file)

### WS-A Board feel — frontend board only
Owns `frontend/src/tutor/board/**` except `board/plugins/idle.ts`, and except the lasso block in
`Whiteboard.tsx` (WS-B may change that block only).
- Pen-stroke writing for tutor `write_math`/`write_text` (handwritten feel; fast — ~0.6–1.5 s per line;
  reveal_step'd items write when revealed). Handwriting-style font for tutor text.
- Camera: follow the tutor's newest item (smooth pan + zoom to a readable scale for the working's
  size); pause following for ~6 s after the student pans/zooms/draws; implement `focus`.
- Laser `point_at`: a red dot that glides to the item, pulses, fades after `hold_ms`.
- `annotate` rendering (hand-drawn ellipse / underline / cross / tick around item or region, incl. student ink).
- Layout: stepped/sequential working stacks **downward** (below the previous item of the same group,
  left-aligned) on the 1000×3000 page; nothing under tldraw's menus (hide the page menu; keep the
  student's pen/colour tools usable).

### WS-B Watching & correcting — agent + idle plugin + circle routing
Owns `agent/watch.py`, `agent/circle.py`, `agent/tests/test_watch.py`, `agent/tests/test_circle.py`,
`frontend/src/tutor/board/plugins/idle.ts` (+ its test), and the lasso block of `Whiteboard.tsx`.
- Idle plugin: track the student's ink; after they wrote and then paused ~6 s, emit one `tutor.idle`
  with a snapshot of their recent ink region (fits the RPC/text budget; JPEG like `fitSnapshot`).
- `handle_idle`: never while the tutor is speaking; fast Haiku vision check with a forced tool
  `{verdict: ok|hint|mistake, item_ids, say, correction_latex}`; `ok` → silent; `hint` → a new tutor
  turn with a short spoken hint (optionally a small written nudge); `mistake` → `annotate` circle (red)
  on the wrong part, write the correction **below** it in pen, explain in one or two sentences.
  Rate-limit (no more than one intervention per ~15 s).
- Circle-to-Ask: find out why it doesn't work today and fix it (systematic debugging, failing test first).
  Routing in `circle.py`: `source:"slide"` → prefer a richer animation (on the slide via WS-C tools, or
  `start_visual`) unless it is a derivation → `show_tab("board")` and work it by hand.
- `watch.RULES`: how to hint and correct (circle → write below → explain).

### WS-C Presentations — backend deck + Slides tab + slide tools + shell
Owns `backend/tutor/deck.py` (+ router additions + tests), `frontend/src/tutor/slides/**`,
`frontend/src/tutor/shell/**` (Stage tab, CallView, Lobby "Prepare slides"), `agent/slides.py`
(+ `agent/tests/test_slides.py`).
- Deck generation (Sonnet, before the lesson, cached per track): from the track's materials and
  knowledge points → 5–8 slides that cover the KPs, intuition first. Each slide: id, title, kp_ids,
  objects with ids (math, text, plot with animated trace/moving point, arrows, shapes), animation
  steps, and short narration hints per step. Ship a hand-checked deck for the demo track as a fallback.
- Slides tab: renders a slide with smooth 3Blue1Brown-style motion (draw-on curves, moving points,
  equation morph/fade, staggered reveals); its own laser + lasso circle (emits `CircleEvent` with
  `source:"slide"`, `slide_id`, `item_ids`); a "new animation" area for circled-content follow-ups.
- Agent RPC + tools: `show_tab`, `slide_go`, `slide_step`, `slide_point`; `slides.RULES` (teach the
  deck: speak, then step; point at what you're talking about; check understanding per KP).

## Global constraints

- Don't break what works: all existing tests stay green (`frontend: npm run test`, `agent: uv run pytest -q`,
  `backend: .venv/bin/python -m pytest tutor/tests -q`), `npx tsc --noEmit` clean.
- Never read, print or copy `.env` files. Never run a live session with a real microphone.
- TDD for logic; comment only the why; match surrounding style.
- Voice latency first: nothing new on the voice path may add a blocking network call.
