# Phase 3 — Live AI Tutor (master plan)

Owner: Fuchun · Status: **design, not yet approved — nothing implemented** · Last updated: Sat 14 Nov 2026

This folder is the single source of truth for Phase 3. It does **not** replace the team's [`implementation_guide.md`](../implementation_guide.md); it narrows Phase 3 ("Spatial Circle-to-Ask, Avatar & Frontend") into a live tutor and defines how it plugs into the rest of ScholarTwin without clashing. Agent briefs for building it live in [`MASTER_PROMPT.md`](MASTER_PROMPT.md).

---

## 1. Vision

A **live, face-to-face AI tutor** that feels like a Zoom lesson with a real tutor:

- You pick a tutor (face, voice, teaching style) and start a call.
- You talk; the tutor answers **instantly** by voice, with a lip-synced face.
- You and the tutor share a **whiteboard**. The tutor writes equations, draws diagrams, steps through animations and drops in generated images. You write too: answers, workings, questions.
- When something is unclear, you **circle it** (on the board, an equation, a generated visual) and say "I don't get this". The tutor sees exactly what you circled and **re-explains it a different way**.
- Learning is organised into **Learning Tracks** (one per topic, like Projects in ChatGPT/Claude): each track keeps its uploaded materials, past lessons and what you've mastered. The tutor **remembers** across lessons and adapts to how *you* learn.

## 2. Context and constraints

| Item | Detail |
|---|---|
| Hackathon | Imperial AI Hack, **Autonomous Agents** track. Devpost by **Sun 15 Nov 12:00**: write-up, GitHub link, **required 2-minute demo video**. Live judging Sun 13:00–16:30 |
| Bounties | Max **2** per team. Synthesia (Interactive Avatar) is ours. Second is a **team decision** — recommendation in §9 |
| Team | 3 people. Teammates own Phases 1, 2, 4 of the guide (data, ingestion, Paper2Sim, HypothesisGraph, fine-tuning, polish). Fuchun owns Phase 3 |
| Time | ~20 h left. Building closes Sat 21:00 – Sun 10:00, **but the team keeps building off-site overnight** |
| Already working | LiveKit voice agent + Synthesia avatar **Kenji** + ElevenLabs STT/TTS + Claude Haiku, LiveKit Cloud project `ai-hackerthon`. Prototype at `AI_HACKERTHON/agent.py` (outside the repo) |
| Repo stack (teammates) | Next.js 16.4 + React 19.3 + Tailwind + React Flow (`@xyflow/react` 12) frontend; FastAPI + PyMuPDF + numpy/scipy backend; `UIAnnotation` / `SpatialAsk*` schemas; 3-pane workspace at `/` |
| Demo machine | Chrome's microphone is blocked → test and record in **Safari** |
| Cost | Synthesia credits are plentiful for the hackathon (~3 M tokens, key in the local `.env`), and several avatars can be used. Voice-only mode stays available for fast development, not to save quota |

## 3. MVP scope

Goal: **a working demo of every feature in a simple form**, not a robust product. No hour-long context, no fine-tuning, no Miro.

### Must (the demo path)
| # | Feature | Simple version for the MVP |
|---|---|---|
| M1 | Tutor picker | 3 tutors, each with its **own Synthesia avatar**, a matching ElevenLabs voice and a teaching style (e.g. visual explainer, Socratic coach, worked-examples drill) |
| M2 | Learning Tracks | Create a track, upload a PDF/URL (reuses the team's `/api/ingest/*`), see its knowledge points and past lessons |
| M3 | Live call, Zoom/Teams style | Pre-join lobby (pick tutor + track, mic/camera check) → call view with video tiles (tutor large, your self-view small), main stage, bottom control bar, red "Leave" button (§4) |
| M9 | **Interruption** | Talk over the tutor at any moment and it stops within ~300 ms, like a real person. It knows exactly where it was cut off and responds to your confusion. A **"I'm lost" button** does the same without speaking |
| M10 | **Live captions** | Both sides, word-synced to the tutor's speech, toggled with a CC button; also visible in the demo video |
| M11 | **Screen share** | Share your screen or a window (your notes, a problem sheet). It becomes the main stage and the tutor can look at it ("what's on my screen?") |
| M4 | Shared whiteboard | Tutor writes text, LaTeX equations, shapes, arrows, function plots, and reveals multi-step "animations" step by step; user draws and types freely |
| M5 | Circle-to-Ask on the board | User circles a region → PNG crop + list of board items inside → tutor sees it (vision) and re-explains in a **different** way than before |
| M6 | Comprehension check | Tutor asks a question, user answers on the board, tutor reads it (snapshot → vision) and responds |
| M7 | Lesson plan + coverage | Each track has a short knowledge-point checklist; the tutor marks points introduced/understood; panel shows progress |
| M8 | Memory across lessons | At lesson end, a summary (covered, struggles, what worked) is saved; next lesson starts with "Last time we covered…" and avoids explanations that didn't work |

### Should (if time)
| # | Feature |
|---|---|
| S1 | Generated illustrations on the board via **fal** (fast image model) — tutor keeps talking while the image arrives |
| S2 | Learner profile: preferred style (visual/verbal/worked examples), level, pace — set in a 3-question onboarding, updated from lessons |
| S3 | "Explain differently" ladder: analogy → diagram → worked example → simpler prerequisite, chosen from what failed before |
| S4 | Session recap card at the end (what we covered, what to practise) |

### Later (explicitly out of MVP)
Miro/other whiteboard integrations, hour-long lessons with full-fidelity context, per-user fine-tuned models (Adaption), multiple users in one lesson, mobile, deployment to LiveKit Cloud.

## 4. How it fits the existing app (no-clash principle)

**The tutor lives on its own route: `/tutor`.** The team's 3-pane workspace at `/` stays untouched. A single link/button from the workspace header opens the tutor (one small, announced edit).

```
/            (teammates)  LectureGraph · Paper2Sim · HypothesisGraph · Circle-to-Ask   — unchanged
/tutor       (Phase 3)    Zoom/Teams-style lesson app (below)
```

**`/tutor` UI (Zoom/Teams pattern)**

```
Lobby                                   Call view
┌──────────────────────────────────┐    ┌──────────────────────────────────────────┬───────────────┐
│ Choose your tutor   [Ada][Aiden][Kenji] │ Main stage: Whiteboard │ Shared screen  │ ┌───────────┐ │
│ Learning Track  [Gradient Descent ▾]│    │  (tabs, like Zoom's shared content)       │ │ Tutor     │ │
│ + New track / Add material         │    │                                            │ │ (avatar)  │ │
│ Mic ▮▮▮▯  Camera preview           │    │                                            │ └───────────┘ │
│            [ Join lesson ]         │    │                                            │ ┌─────┐ You   │
└──────────────────────────────────┘    │                                            │ └─────┘       │
                                         │ CC  "…so the momentum term β keeps…"       │ Side panel:   │
                                         ├──────────────────────────────────────────┤ Captions|Lesson│
                                         │ 🎤 Mic  📷 Cam  🖥 Share  ✏️ Board  ⭕ Circle  ✋ I'm lost  CC  ⋯  [Leave] │
                                         └──────────────────────────────────────────────────────────┘
```
- **Main stage** shows the shared whiteboard by default, or your shared screen when sharing. You can circle on either.
- **Video tiles**: the tutor's avatar is large; your camera is a small self-view tile. Your camera is shown to you only; it isn't sent to the AI.
- **Side panel** tabs: live transcript (captions history), lesson progress (knowledge points, "last time"), materials.
- **Control bar**: mic, camera, share screen, whiteboard, circle mode, "I'm lost", captions toggle, leave.

What the tutor **reuses** from the team, read-only:
- `POST /api/ingest/pdf`, `POST /api/ingest/url` → turn uploads into `{nodes, edges}`; nodes seed the track's knowledge points.
- `POST /api/simulate` → tutor can plot a Paper2Sim simulation on the board.
- `POST /api/ask-spatial` → optional tool: "ask the workspace about these nodes".
- `UIAnnotation`, `WorkspaceDataset` shapes from `schemas.py` / `types/scholartwin.ts` — imported, never modified.
- Visual style: same Tailwind palette/components so `/tutor` looks like part of ScholarTwin.

What Phase 3 **adds** (new files only, see §8): `agent/`, `backend/tutor/` (mounted with one `include_router` line), `frontend/src/app/tutor/`, `frontend/src/tutor/`.

Later (after the MVP, if the team wants): the same live tutor can be docked into the workspace's left `AvatarDock`, using the contracts below.

## 5. Architecture

```
Browser /tutor (Next.js)                       FastAPI :8000                         Tutor agent worker (Python, LiveKit Agents)
────────────────────────                       ─────────────                         ────────────────────────────────────────────
Tracks sidebar ── /api/tutor/tracks ─────────▶ backend/tutor  ──▶ Memory store       FAST LOOP (voice, < 1 s to first word)
Start lesson ──── /api/tutor/session ────────▶  token + dispatch + lesson context     ElevenLabs STT ─▶ Claude Haiku ─▶ ElevenLabs TTS
   │                                                                                  ─▶ Synthesia avatar (lip-sync video)
   ├── LiveKit room ◀── tutor video/voice, captions ◀──────────────────────────────────┘
   ├── mic ───────────────────────────────────────────────────────────────────────▶ STT
   ├── RPC board.apply(ops)  ◀────────────── tools: write/draw/plot/reveal ─────────── tool calls (instant, structured ops)
   ├── RPC board.describe()  ◀────────────── tool: look_at_board ───────────────────── board summary (text, cheap)
   ├── RPC board.snapshot(region) ◀───────── tool: look_at_board(region) ───────────── PNG → vision (only when needed)
   ├── text/byte stream "tutor.circle" ────▶ user circled: PNG crop + items inside ─▶ new user turn with image
   ├── screen-share track ─────────────────▶ agent video input (latest frame) ──────▶ tool: look_at_screen
   ├── text stream "tutor.lost" ───────────▶ "I'm lost" button ─────────────────────▶ interrupt + re-explain
   ├── transcriptions (both sides) ◀────────── TTS-aligned captions ◀──────────────── session transcripts
   └── attributes: track id, lesson id ─────▶                                         SLOW WORKERS (async, never block speech)
                                               ◀── /api/tutor/memory (read/write) ──  • lesson summariser (rolling, every few turns)
                                                                                     • illustration (fal) → board.apply(place_image)
                                                                                     • animation planner (larger Claude) → board ops
```

### Design rules
1. **Fast loop vs slow workers.** The voice loop only does things that finish in well under a second. Anything slow (image generation, planning a multi-step animation, summarising) runs as a background task; the tutor says "let me sketch that" and the result appears on the board when ready. This is how it stays "live".
2. **Structured board, not pixels.** The tutor never draws by pixel coordinates. It emits **board ops** (`write_math`, `draw_arrow`, `plot_function`, `reveal_step` …) with semantic placement (`next`, `below:<id>`, `right_of:<id>`); a small layout engine in the browser turns them into whiteboard shapes. Fewer tokens, faster, never off-screen.
3. **Board state as text first, image on demand.** The page keeps a compact text description of the board (items, ids, author, content). The tutor reads that every turn for free; it requests a PNG snapshot only when the user circled something or wrote an answer to check.
4. **Context is layered, not endless** (the long-lesson bottleneck, MVP version):
   - *Static, cached:* tutor persona + learner profile + track's knowledge points + last lessons' summaries → system prompt with Claude prompt caching.
   - *Rolling:* last ~10 turns verbatim + a running lesson summary that a background worker refreshes every few turns.
   - *Board:* current text description (rule 3).
   - *Persistent:* at lesson end, summary + knowledge-point updates + "what worked / what didn't" go to memory.
   This keeps every request small and fast whatever the lesson length; the full-fidelity hour-long version is a "Later" item.
5. **Fallbacks.** No avatar (quota/timeout) → voice-only with an animated placeholder. No microphone → text box. No fal → tutor draws a diagram instead.

## 6. Recommended frameworks and models

| Need | Choice | Why / notes |
|---|---|---|
| Real-time voice + avatar | **LiveKit Agents (Python) 1.8** + `livekit-plugins-synthesia` | Already working; streaming STT→LLM→TTS, barge-in, turn detection, RPC, text/byte streams |
| Conversational brain | **Claude Haiku 5.5** (`claude-haiku-5-5`), no extended thinking, short `max_tokens`, `caching="ephemeral"` | Fastest Claude; good tool use; **vision** (reads circled crops and answers) |
| Heavier planning (async) | **Claude Sonnet 5.5** (`claude-sonnet-5-5`) in slow workers only | Multi-step animation plans, lesson plans from uploads |
| Speech to text | ElevenLabs `scribe_v2_realtime` | Already working, streaming |
| Text to speech | ElevenLabs **`eleven_flash_v2_5`** (switch from turbo) | Lowest-latency ElevenLabs model, supported by the installed plugin |
| Latency helpers | LiveKit `preemptive_generation`, turn detector, short replies (1–3 sentences) | Starts thinking before the user finishes |
| Interruption | LiveKit turn handling (`TurnHandlingOptions`: interruptions on, short `min_interruption_duration`) | Tutor stops mid-sentence; LiveKit keeps only the words actually spoken in history, so the tutor knows where it was cut off |
| Captions | LiveKit transcriptions with `use_tts_aligned_transcript=True` | Word-synced tutor captions + student captions from STT |
| Screen understanding | LiveKit room video input (`video_enabled`) + `livekit.agents.utils.images.encode` | Tutor grabs the latest shared-screen frame only when it needs to look |
| Whiteboard | **tldraw 5.6** (React 19 compatible) | Programmatic shapes API, export region to PNG, draw/select/lasso built in. Shows a watermark without a licence key — fine for a hackathon. Alternative: Excalidraw 0.18 (MIT) |
| Equations | KaTeX (rendered into board shapes) | Fast, no server |
| Plots | function-plot or Plotly | `plot_function` and Paper2Sim results |
| Generated images | **fal** (fast image model, e.g. FLUX schnell) | $25 credits claimed; ~1–2 s; async worker |
| Memory | **MongoDB Atlas** (free cluster, $50 credits) — or local JSON files if the team picks another bounty | Profiles, tracks, lessons; Vector Search later for "find past explanations" |
| Personalisation (later) | Adaption fine-tuning on logged lessons | Team's Track C / Adaption extra prize |

## 7. Data model (MVP)

```
LearnerProfile  { user_id, name, style: "visual"|"verbal"|"examples", level, pace, notes[] }
Track           { track_id, user_id, title, materials[{kind, ref, dataset_title}], knowledge_points[KP], created_at }
KP              { kp_id, title, summary, prereq_ids[], status: "not_started"|"introduced"|"understood", evidence }
Lesson          { lesson_id, track_id, tutor_id, started_at, ended_at, summary, covered_kp_ids[],
                  struggles[{kp_id, what, tried_explanations[]}], worked[{kp_id, explanation_style}], board_snapshot_ref }
Tutor           { tutor_id, name, avatar_id, voice_id, style_prompt }
```

## 8. Interfaces (contracts between workstreams)

### Backend — `backend/tutor/` (FastAPI `APIRouter`, prefix `/api/tutor`)
| Endpoint | Purpose |
|---|---|
| `GET /tutors` | list of `Tutor` |
| `GET/POST /tracks`, `GET /tracks/{id}` | list/create/read tracks (with KPs and lesson summaries) |
| `POST /tracks/{id}/materials` | upload PDF/URL → calls the team's ingest code → adds material + seeds KPs from nodes |
| `POST /session` `{track_id, tutor_id}` | returns `{url, token, room, lesson_id}`; token dispatches agent `TUTOR_AGENT_NAME` with `sync_streams=True` and room metadata `{track_id, lesson_id, tutor_id}` |
| `GET /context/{lesson_id}` | (agent only) profile + track KPs + last 3 lesson summaries + tutor persona |
| `POST /lessons/{id}/progress` | KP status updates, struggles, what worked |
| `POST /lessons/{id}/end` | final summary, board snapshot |

### Board ops — RPC `board.apply` (agent → page), payload `{ops: BoardOp[]}`, reply `{ok, ids[], errors[]}`
```
write_text   {id?, text, place}            write_math  {id?, latex, place}
draw_shape   {id?, shape: rect|ellipse|line, label?, place}
draw_arrow   {id?, from_id, to_id, label?}
plot_function{id?, expr | points, x_range, label?, place}
place_image  {id?, url, caption?, place}
highlight    {target_id, color?}            reveal_step {group_id, step}
erase        {target_id}                     clear_tutor_layer {}
(every drawable op also accepts optional `group` + `step` for step-by-step reveals)
place := "next" | "below:<id>" | "right_of:<id>" | "region:<x,y,w,h in board units 0-1000>"
```
Other RPCs: `board.describe` → `{items:[{id, type, author, text|latex|label, bbox}]}`; `board.snapshot {region?}` → `{png_b64}`.

### Circle event — byte/text stream topic `tutor.circle` (page → agent)
`{png_b64, region, item_ids[], user_text?, source: "board"|"screen"}` → the agent adds it as a user turn with an image.

### "I'm lost" — text stream topic `tutor.lost` (page → agent)
`{}` → the agent interrupts its current speech and asks/re-explains at the point it was cut off.

### Screen share
The student publishes a screen-share video track; the agent subscribes and keeps the latest frame. Tool `look_at_screen()` attaches that frame as an image to the next turn.

### Tutor dispatch
Lesson info travels as **agent dispatch metadata** (`RoomAgentDispatch.metadata`, read by the agent as `ctx.job.metadata`): `{track_id, lesson_id, tutor_id}`. The tutor's persona, avatar id and voice id come from `GET /api/tutor/context/{lesson_id}`.

### Env vars
`agent/.env`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SYNTHESIA_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `FAL_KEY`, `TUTOR_API_BASE`, `TUTOR_AGENT_NAME` (per developer, e.g. `tutor-fuchun`), `TUTOR_AVATAR` (`0` = voice only, saves Synthesia quota).
`backend/.env`: `LIVEKIT_*`, `TUTOR_AGENT_NAME`, `MONGODB_URI` (or empty → JSON files in `backend/tutor/data/`).
All `.env` files are git-ignored already.

## 9. Decisions and recommendations

| Decision | Recommendation | Status |
|---|---|---|
| Where the tutor UI lives | Separate `/tutor` route | proposed |
| Second bounty | **MongoDB** ("agent memory" is literally their brief) over Tavily | **team decision** |
| Whiteboard library | tldraw (Excalidraw if licence watermark is a problem) | proposed |
| Memory store | MongoDB Atlas; JSON fallback | depends on bounty |
| Tutor faces | 3 tutors. Stock video-avatar ids are rejected for live sessions (`UNKNOWN_AVATAR`, tested). New faces need Studio avatar ids (`av_…`) converted with `POST /api/interactive-avatars/avatars`. Until then all tutors use Kenji with different voices and styles | waiting on Studio `av_` ids |
| Work overnight | yes, off-site | decided |
| UI pattern | Zoom/Teams: lobby → call view with stage, tiles, control bar, side panel | decided |
| Use of fal | Async illustrations only (S1) | proposed |

## 10. Demo script (2-minute video, draft)

1. **Pick tutor + track** (10 s): choose "Kenji — visual explainer", open track *Gradient Descent*, show uploaded lecture PDF and its knowledge points.
2. **Live explanation** (35 s): "Can you explain momentum?" → Kenji explains while writing the update equation and plotting a damped curve step by step.
3. **Interrupt + Circle-to-Ask** (30 s): mid-sentence the student cuts in "wait — what's β?"; the tutor stops instantly. The student circles the β term; the tutor re-explains with an analogy and a new sketch (captions on throughout).
4. **Check understanding** (20 s): Kenji asks a question, user writes the answer on the board, Kenji reads it and corrects.
5. **Memory** (20 s): end lesson → recap card; start a new lesson → "Last time the ball analogy helped; let's build on that."
6. **Close** (5 s): tracks, progress, tutors.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Latency over ~1.5 s feels unnatural | Haiku + flash TTS + preemptive generation; slow work always async |
| Model draws badly placed shapes | Semantic placement + layout engine; small op vocabulary |
| Synthesia quota runs out | Voice-only mode for development; budget full runs |
| Merge conflicts with teammates | New folders only; one `include_router` line and one header link, announced |
| Scope too big for ~20 h | Build in the order of §3 Must; freeze whatever works by the video slot |

## 12. Open questions for the team

1. When do we record the 2-minute video? (sets the code-freeze time; overnight work is confirmed)
2. Second bounty: MongoDB, Tavily, or something else?
3. Is the `/tutor` route + one header link acceptable to the owners of `page.tsx`?
4. Which lecture/paper do we use as the demo track? (ideally one the team already pre-cached)
