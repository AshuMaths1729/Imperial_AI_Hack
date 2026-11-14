# Phase 3 Live Tutor — master prompt and agent briefs

How to use this file:
1. Every build agent gets **§1 Master prompt** + **its own brief from §3**.
2. Agents work in parallel on the workstreams in §2. File ownership never overlaps.
3. The coordinator (main session) runs **§4 Integration cross-check** when the workstreams report back, fixes contract mismatches, and runs the end-to-end demo.

Nothing here is approved for implementation until the team signs off [`README.md`](README.md).

---

## 1. Master prompt (give to every agent)

```text
You are building one workstream of "Phase 3 — Live AI Tutor" for ScholarTwin, a hackathon project
(Imperial AI Hack, Autonomous Agents track; Devpost deadline Sun 15 Nov 12:00, 2-minute demo video required).

Read first, in this order:
  1. phase3-live-tutor/README.md   — vision, MVP scope, architecture, contracts (§8 is binding)
  2. implementation_guide.md       — the team's overall plan (context only; do not edit)
  3. Your brief below.

Product in one line: a live, face-to-face AI tutor (Synthesia avatar + ElevenLabs voice + Claude) that talks
with the student in real time, shares a whiteboard with them (both can write and draw; the tutor writes equations,
diagrams, plots and step-by-step animations), re-explains anything the student circles, and remembers each student's
progress across lessons within "Learning Tracks".

Rules — breaking any of these fails the task:
  - Only create or edit files listed under "You own" in your brief. If you need a change elsewhere, stop and report
    it as a request; do not make it.
  - Never edit teammates' code: backend/main.py (except the one include_router line if your brief says so),
    backend/schemas.py, frontend/src/app/page.tsx, frontend/src/components/*, frontend/src/types/scholartwin.ts,
    demo data, start.sh.
  - Implement the contracts in README §8 exactly (names, payloads, replies). If a contract is wrong or missing,
    report it; do not invent a variant.
  - Latency is a feature: nothing in the voice loop may block for more than ~300 ms. Slow work is async.
  - No secrets in code, logs or git. Read keys from env vars named in README §8. .env files stay git-ignored.
  - MVP mindset: simplest version that demonstrably works. No speculative abstractions, options or config.
  - This repo's Next.js (16.4) has breaking changes: read node_modules/next/dist/docs/ before writing frontend code.
  - Verify library APIs against installed versions (pip/npm), not memory. LiveKit Agents is 1.8.x.
  - Each non-trivial function gets one small test or assert-based self-check. Provide a way to run your part
    alone with mocks for the other workstreams.
  - Work on your workstream branch (phase3/ws<N>-...) cut from phase3/base; commit after each task. Never push.
  - The step-by-step tasks for your workstream are in phase3-live-tutor/IMPLEMENTATION_PLAN.md; follow them.

When done, report:
  1. Files created/edited (paths).
  2. How to run and test your part alone (exact commands).
  3. What you verified actually works, and what you could not verify.
  4. Any contract issues or requests for other workstreams.
```

---

## 2. Workstreams at a glance

| WS | Name | Owns (create/edit only these) | Depends on (via contracts, mock until ready) |
|---|---|---|---|
| 1 | Tutor agent (fast loop) | `agent/**` except `agent/workers/**` | WS4 `/context`, `/progress`, `/end`; WS2 board RPCs |
| 2 | Whiteboard | `frontend/src/tutor/board/**` | none (pure component + RPC handler functions) |
| 3 | Tutor app shell | `frontend/src/app/tutor/**`, `frontend/src/tutor/shell/**` (frontend deps are added once by the coordinator in Task 0) | WS2 components, WS4 API |
| 4 | Tutor backend | `backend/tutor/**`, `backend/requirements.txt` (add deps only), **one** `app.include_router(...)` line in `backend/main.py` | team's `/api/ingest/*` via the browser (no imports from `main.py`) |
| 5 | Slow workers | `agent/workers/**` | WS1 hook to start workers; WS2 `board.apply` ops |

Suggested order: start WS2 and WS4 immediately (no dependencies) → WS1 with mocks → WS3 once WS2 exports exist → WS5 last (Should-tier).

---

## 3. Briefs

### WS1 — Tutor agent (fast loop)

**Goal.** The real-time tutor: hears the student, answers in under ~1 s, drives the whiteboard through tools, reacts to circled regions, tracks lesson progress, and writes memory at the end.

**You own.** `agent/**` except `agent/workers/**` (file list in IMPLEMENTATION_PLAN Tasks 1.1–1.5). Personas come from the backend's `/context`, not from agent code.

**Start from.** The working prototype `../agent.py` (one level above the repo): LiveKit Agents 1.8.12, Synthesia Kenji `7572faa9-15da-400d-8227-ef1ab8932523`, ElevenLabs `scribe_v2_realtime` + voice `JBFqnCBsd6RMkjVDRZzb`, Claude `claude-haiku-5-5`, Silero VAD. Copy, don't import.

**Build.**
1. Worker named `TUTOR_AGENT_NAME`. On job start read room metadata `{track_id, lesson_id, tutor_id}`, fetch `GET /api/tutor/context/{lesson_id}`, build the system prompt: persona + learner profile + KPs + last lesson summaries. Enable Anthropic prompt caching on it.
2. Voice loop: ElevenLabs STT → Claude Haiku (`max_tokens` small, no extended thinking) → ElevenLabs TTS `eleven_flash_v2_5` → Synthesia avatar (skip avatar when `TUTOR_AVATAR=0`). Turn on preemptive generation. Persona style rules: 1–3 spoken sentences, no markdown, put detail on the board instead of reading it aloud.
3. Tools (each calls RPC on the student participant and returns the page's reply to the LLM — never claim success without `ok`):
   `board_write(ops)` → `board.apply` · `look_at_board(region?)` → `board.describe`, plus `board.snapshot` as an image when a region is given · `mark_progress(kp_id, status, evidence)` → `POST /lessons/{id}/progress` · `note_struggle(kp_id, what, tried)` and `note_worked(kp_id, style)` → same endpoint · `start_visual(kind, brief)` → hands off to WS5 (stub returning "queued" until WS5 lands).
4. Circle events on topic `tutor.circle`: add a user turn containing the PNG (`ImageContent`) + item ids + text, then generate a reply. Instruction: re-explain differently from what is already on the board for those items.
5. Context manager: keep the last ~10 turns verbatim; every ~6 turns a background task (Haiku) folds older turns into a running lesson summary. Every turn includes the latest `board.describe` text.
6. On disconnect or end: `POST /lessons/{id}/end` with summary, covered KPs, struggles, what worked.
7. Live-call behaviour: interruptions on with a short minimum duration (the tutor stops within ~300 ms when the student speaks); TTS-aligned transcripts for word-synced captions; on `tutor.lost` interrupt current speech and re-explain from where it stopped; room video input enabled so `look_at_screen()` can attach the latest screen-share frame.

**Acceptance.**
- With `TUTOR_AVATAR=0` and a mock page that answers RPCs with `ok`, the agent starts a lesson, speaks a greeting that uses the mocked context, and calls `board_write` when asked "write the formula for momentum".
- A synthetic `tutor.circle` event produces a reply that references the circled item.
- `POST /end` is called with a non-empty summary when the room closes.
- Unit tests for prompt building and the RPC tool wrappers (fake RPC).

---

### WS2 — Whiteboard

**Goal.** A shared whiteboard component where the student draws freely and the tutor's board ops render instantly and neatly, plus Circle-to-Ask capture.

**You own.** `frontend/src/tutor/board/**` (e.g. `Whiteboard.tsx`, `ops.ts`, `layout.ts`, `circle.ts`, `describe.ts`, `index.ts`, tests).

**Build.**
1. Embed **tldraw** (verify the installed version's API; React 19). Two layers by author: `tutor` and `user` (shape meta).
2. `applyOps(ops: BoardOp[]) → {ok, ids, errors}` implementing every op in README §8, including KaTeX for `write_math`, a function plot for `plot_function`, `reveal_step` for grouped step animations, `place_image` from URL.
3. Layout engine for `place` (`next`, `below:<id>`, `right_of:<id>`, `region:` in 0–1000 board units). Never place outside the visible board; reflow to the next free row.
4. `describeBoard() → {items:[{id,type,author,text|latex|label,bbox}]}` — compact; include user handwriting as `{type:"ink", bbox}`.
5. `snapshot(region?) → png_b64`.
6. Circle mode: a toggle; the user lassos a region → `{png_b64, region, item_ids[]}` passed to an `onCircle` callback prop.
7. Export everything from `index.ts` with the RPC handler functions (`handleApply`, `handleDescribe`, `handleSnapshot`) for WS3 to register on the LiveKit room.

**Acceptance.**
- A standalone dev page (inside your folder, e.g. a story or test harness) renders a scripted sequence: equation, plot, arrow between them, 3-step reveal, image — all readable, nothing overlapping.
- Lasso returns a crop and the ids of items inside it.
- Unit tests for `layout.ts` placement and op validation (unknown op or missing target → error, not crash).

---

### WS3 — Tutor app shell

**Goal.** The `/tutor` page as a **Zoom/Teams-style lesson app**: a lobby to pick tutor and Learning Track, then a call view with a main stage (whiteboard or shared screen), video tiles, live captions, side panel and a control bar.

**You own.** `frontend/src/app/tutor/**`, `frontend/src/tutor/shell/**`.

**Build.**
1. Layout per README §4 (ScholarTwin's Tailwind palette): **Lobby** (tutor cards with avatar previews, track picker, new track / add material, mic level + camera preview, Join) → **Call view**: main stage with Whiteboard / Shared screen tabs; tutor tile (large) + self-view tile (small, local only); captions overlay; side panel tabs Transcript | Lesson (KPs with status, "last time") | Materials; control bar Mic, Camera, Share screen, Board, Circle, "I'm lost", CC, Leave (red).
2. Tutor picker (from `GET /api/tutor/tutors`) before starting a lesson.
3. Upload: send the file/URL to the team's existing `POST /api/ingest/pdf` or `/api/ingest/url`, then `POST /api/tutor/tracks/{id}/materials` with the returned dataset.
4. `useTutorSession()` hook: `POST /api/tutor/session` → connect LiveKit (`adaptiveStream: false`), publish mic, render the avatar's video (participant identity `synthesia-avatar-agent`) or a placeholder in voice-only mode, show transcriptions, register WS2's RPC handlers (`board.apply`, `board.describe`, `board.snapshot`), send circle events on topic `tutor.circle`. Never auto-start; disconnect on End and page unload.
5. Progress panel refreshes from `GET /api/tutor/tracks/{id}` after `progress` updates (polling every few seconds is fine for the MVP).

**Acceptance.**
- With WS4 running and the agent in voice-only mode, a lesson starts, captions appear, a tutor `board.apply` renders on the board, End closes the room.
- Without the agent, the page still loads tracks and uploads; Start shows a clear error instead of hanging.
- Nothing on `/` (the team's workspace) changes. The header link from `/` to `/tutor` is a **request to the coordinator**, not an edit you make.

---

### WS4 — Tutor backend

**Goal.** Tracks, memory, session tokens and lesson context for the tutor, as a separate FastAPI router.

**You own.** `backend/tutor/**` (`router.py`, `store.py`, `models.py`, `livekit_token.py`, `data/` for JSON fallback, tests), dependency additions in `backend/requirements.txt` (`livekit-api`, `python-dotenv`, `pymongo` if used), and exactly one line in `backend/main.py`: `app.include_router(tutor_router)` (plus its import).

**Build.**
1. Pydantic models from README §7.
2. Store with two backends behind one small interface: MongoDB when `MONGODB_URI` is set, JSON files in `backend/tutor/data/` otherwise. Seed one demo learner and 2 tutors.
3. All endpoints in README §8 under prefix `/api/tutor`. `materials` accepts a `WorkspaceDataset` JSON (produced by the team's ingest endpoints via the browser) and seeds KPs from its nodes (id, label, summary; prerequisites from `prerequisite` edges). Do not import from `main.py`.
4. `POST /session`: create the lesson, mint a LiveKit token (room `tutor-<lesson_id>`, identity `student-<user_id>`, `RoomAgentDispatch(agent_name=TUTOR_AGENT_NAME)`, `sync_streams=True`, room metadata `{track_id, lesson_id, tutor_id}`), return `{url, token, room, lesson_id}`. Verify `sync_streams` support in the installed `livekit-api`.
5. `GET /context/{lesson_id}`: persona + profile + KPs + last 3 lesson summaries, in one call.

**Acceptance.**
- Tests: create track → add materials → KPs seeded; `/session` token decodes with the right room, identity, dispatch and metadata; `/progress` and `/end` update the stored lesson and KP statuses; JSON fallback works with no `MONGODB_URI`.
- `uvicorn main:app` still serves every existing team endpoint unchanged.

---

### WS5 — Slow workers (Should tier)

**Goal.** Rich visuals that take seconds, without ever blocking the tutor's voice.

**You own.** `agent/workers/**` (`illustrate.py`, `animate.py`, `summarise.py` if WS1 delegates it, tests).

**Build.**
1. `illustrate(brief) → place_image op`: fal fast image model (`FAL_KEY`), returns URL; on failure returns a `write_text` op saying the sketch is unavailable.
2. `animate(brief, board_description) → BoardOp[]`: Claude Sonnet 5.5 plans a 3–6 step explanation as board ops with one `group_id` and `reveal_step`s; validate ops against the contract before returning.
3. Both run as background asyncio tasks started by WS1's `start_visual`; results are applied via `board.apply`, and the tutor is told (a system note in chat) so it can say "here it is".

**Acceptance.** Given a brief, each worker returns valid ops in under its budget (illustrate ≤ 5 s, animate ≤ 8 s) or a graceful fallback; tests with mocked fal/Anthropic clients.

---

## 4. Integration cross-check (coordinator)

Run after the workstreams report. Each line must be checked against the running system, not the reports.

**Contracts**
- [ ] Every `BoardOp` the agent can emit is accepted by `applyOps` (diff WS1 tool schema vs WS2 `ops.ts`).
- [ ] RPC method names and payloads match README §8 on both sides (`board.apply`, `board.describe`, `board.snapshot`).
- [ ] Circle event topic and payload match (`tutor.circle`).
- [ ] `/api/tutor/*` request/response shapes match what WS1 and WS3 call.
- [ ] Agent name and env vars line up across `agent/.env`, `backend/.env`, token minting.

**No-clash**
- [ ] `git diff --stat` touches only owned paths + the single `include_router` line + dependency additions.
- [ ] `/` workspace: LectureGraph, Paper2Sim, HypothesisGraph and Circle-to-Ask still work exactly as before.
- [ ] Existing backend endpoints respond as before (`/api/health`, `/api/demo/*`, `/api/simulate`, `/api/ingest/*`, `/api/ask-spatial`).

**End-to-end (Safari, voice-only first, then once with the avatar)**
- [ ] Pick tutor → pick track → upload PDF → KPs appear.
- [ ] Start lesson → greeting within ~2 s, uses track context.
- [ ] Ask a question → tutor answers within ~1 s and writes on the board.
- [ ] Circle an item → tutor re-explains differently and adds a new sketch.
- [ ] Tutor asks a question → answer written on board → tutor reads and responds.
- [ ] End lesson → summary saved; new lesson → tutor references the last one.
- [ ] Interrupting the tutor mid-sentence stops it within ~300 ms, and its reply addresses the interruption; the "I'm lost" button does the same.
- [ ] Captions show both sides, word-synced to the tutor's voice; CC toggle works.
- [ ] Screen share becomes the main stage; "what's on my screen?" gets a correct description; circling on the shared screen works.
- [ ] No secrets in the browser bundle or git (`git grep` for key prefixes).
- [ ] Leftover LiveKit rooms deleted after testing (Synthesia quota).

**Demo readiness**
- [ ] The README §10 script runs start to finish twice in a row without a restart.
