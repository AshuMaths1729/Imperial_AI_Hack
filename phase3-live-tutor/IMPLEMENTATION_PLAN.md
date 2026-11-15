# Phase 3 Live Tutor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MVP of ScholarTwin's live AI tutor at `/tutor`: a Synthesia + ElevenLabs + Claude voice tutor that shares a whiteboard with the student, re-explains circled regions, tracks knowledge points and remembers lessons per Learning Track.

**Architecture:** Four new, non-overlapping areas — a FastAPI router (`backend/tutor/`), a LiveKit Agents worker (`agent/`), a tldraw whiteboard (`frontend/src/tutor/board/`) and the `/tutor` page shell (`frontend/src/app/tutor/`, `frontend/src/tutor/shell/`) — talking only through the contracts in README §8 and the JSON Schema in `frontend/src/tutor/contracts/`. Slow visuals run in async workers (`agent/workers/`). The team's workspace at `/` is not modified.

**Tech Stack:** Python 3.12, LiveKit Agents 1.8.12 (`livekit-plugins-synthesia`, `-elevenlabs`, `-anthropic`, `-silero`), `livekit-api` 1.2.3, FastAPI, pymongo (optional); Next.js 16.4.6, React 19.3.0, `livekit-client` 2.24, `tldraw` 5.6, `katex` 0.19, `function-plot` 1.26, `vitest` 5.1; pytest.

**Spec:** [`phase3-live-tutor/README.md`](README.md) (design) and [`phase3-live-tutor/MASTER_PROMPT.md`](MASTER_PROMPT.md) (agent rules and briefs). Executors read both.

## Global Constraints

- Only create/edit files owned by your task (see each task's **Files**). Teammates' files are read-only except where a task names an exact line.
- Never modify `backend/schemas.py`, `backend/main.py` (except Task 4.4's one import + one `include_router` line), `frontend/src/app/page.tsx`, `frontend/src/components/*`, `frontend/src/types/scholartwin.ts`, `start.sh`, demo data.
- Models: voice loop `claude-haiku-5-5`; slow workers `claude-sonnet-5-5`. No extended thinking in the voice loop.
- ElevenLabs STT `scribe_v2_realtime`; TTS model `eleven_flash_v2_5`.
- Default avatar Kenji `7572faa9-15da-400d-8227-ef1ab8932523`; Synthesia avatar participant identity `synthesia-avatar-agent`.
- Env vars exactly as README §8; agent name from `TUTOR_AGENT_NAME`; `TUTOR_AVATAR=0` disables the Synthesia avatar.
- Board coordinates are 0–1000 board units on both axes; the model never sends pixels.
- No secrets in code, logs, git or the browser bundle.
- Next.js 16.4 has breaking changes: read `frontend/node_modules/next/dist/docs/` before writing frontend code.
- Git: each workstream works on its own branch off `phase3/base` (see Task 0) and commits per task. Never push.

## Review Focus

1. **Agent sends an op for an id that doesn't exist, or an unknown op** → the page returns `{ok:false, errors:[...]}` for that op, applies the others, and the agent tells the user it couldn't draw it instead of claiming success. (Tests: Task 2.1 `rejects_unknown_target`, Task 1.2 `test_board_write_reports_errors`.)
2. **Student closes the tab mid-lesson** → the agent still posts `/end` with a summary when the room closes. (Test: Task 1.5 `test_shutdown_posts_end_once`.)
3. **Agent worker isn't running when the student clicks Start** → the page shows "Tutor didn't join — is the agent running?" after 20 s and disconnects, instead of spinning forever. (Test: Task 3.2 `times out when no agent joins`.)
4. **Two uploaded materials both have node ids `n1…n6`** → knowledge points stay distinct (`m0:n1`, `m1:n1`), and a dataset with zero nodes adds a material with no KPs, without errors. (Test: Task 4.2 `test_materials_prefix_and_empty`.)
5. **Huge or empty circle selection** → crops are downscaled to ≤ 1024 px on the long side, and an empty region still sends `item_ids: []` with the crop. (Test: Task 2.3 `downscales large crops` / `empty region yields no items`.)

---

## Execution order

| Phase | Tasks | Who |
|---|---|---|
| 0 — base | Task 0 | coordinator, sequential |
| 1 — parallel | WS4: 4.1–4.4 · WS2: 2.1–2.4 · WS1: 1.1–1.5 · WS3: 3.1–3.5 · WS5: 5.1–5.2 | one agent per workstream, each in its own worktree/branch |
| 2 — integrate | Task 6.1–6.3 | coordinator |

MVP cut line: if time runs short, drop WS5 (Should tier) and Task 3.4's upload UI (seed the demo track via Task 4.1's seed data instead).

---

## Task 0: Base branch, shared contract, frontend dependencies (coordinator)

**Files:**
- Create: `frontend/src/tutor/contracts/board_ops.schema.json`
- Create: `frontend/src/tutor/contracts/examples/valid_ops.json`, `frontend/src/tutor/contracts/examples/invalid_ops.json`
- Modify: `frontend/package.json` (deps + `"test": "vitest run"` script), `frontend/package-lock.json`
- Create: `frontend/vitest.config.ts`
- Modify: `phase3-live-tutor/README.md` §8 (dispatch metadata wording)

**Interfaces:**
- Produces: the JSON Schema both WS1 (Python, `jsonschema`) and WS2 (TS tests) validate against. Top level `{"ops": BoardOp[]}`; `BoardOp` is a `oneOf` keyed by `"op"` ∈ `write_text, write_math, draw_shape, draw_arrow, plot_function, place_image, highlight, reveal_step, erase, clear_tutor_layer` with the fields in README §8. `place` pattern: `^(next|below:[\w-]+|right_of:[\w-]+|region:\d+,\d+,\d+,\d+)$`.
- Produces: branch `phase3/base`; workstream branches `phase3/ws1-agent`, `phase3/ws2-board`, `phase3/ws3-shell`, `phase3/ws4-backend`, `phase3/ws5-workers` cut from it.

- [ ] **Step 1:** `git checkout -b phase3/base` in `Imperial_AI_Hack`.
- [ ] **Step 2:** Write the schema and examples. `valid_ops.json` has one example of every op (12+ ops incl. a 3-step `reveal_step` group); `invalid_ops.json` has: unknown op `"dance"`, `write_math` without `latex`, `place: "somewhere"`, `draw_arrow` missing `to_id`.
- [ ] **Step 3:** Self-check: `uvx --from check-jsonschema check-jsonschema --schemafile frontend/src/tutor/contracts/board_ops.schema.json frontend/src/tutor/contracts/examples/valid_ops.json` → `ok`; same with `invalid_ops.json` wrapped one-op-per-document → each fails.
- [ ] **Step 4:** `cd frontend && npm i livekit-client@2.24.1 tldraw@5.6.0 katex@0.19.1 function-plot@1.26.0 && npm i -D vitest@5.1.0 jsdom @testing-library/react ajv`; add `"test": "vitest run"`; `vitest.config.ts` with `environment: "jsdom"`, `include: ["src/tutor/**/*.test.ts?(x)"]`.
- [ ] **Step 5:** Verify `npm run test` exits 0 with "No test files found" allowed (`--passWithNoTests` in the script), and `npm run build` still succeeds.
- [ ] **Step 6:** README §8: replace "room metadata `{track_id, lesson_id, tutor_id}`" with "agent dispatch metadata (`RoomAgentDispatch.metadata`, read by the agent as `ctx.job.metadata`)"; note personas come from `GET /api/tutor/context` (no `agent/personas.py`).
- [ ] **Step 7: Verify tutor avatars.** Candidates (Synthesia stock list; live-avatar support unconfirmed): Ada `77d4d471-49d9-4c29-959e-314eabbb15a4`, Aiden `0d46d4a6-386c-48d1-a036-9bd488de76ae`, Kenji `7572faa9-15da-400d-8227-ef1ab8932523` (known good). For each: in a scratch copy of the prototype `../agent.py` replace the avatar id, run `uv run agent.py dev`, `lk dispatch create --room avatar-check --agent-name synthesia-avatar-agent`; log `remote participant ready` = OK, `UNKNOWN_AVATAR` = replace with another stock id of the same gender. `lk room delete avatar-check` after each. Write the 3 verified ids into README §9 and Task 4.1's seed.
- [ ] **Step 8:** Commit `chore(phase3): base contracts and frontend deps`; create the five workstream branches.

---

## WS4 — Tutor backend (`backend/tutor/`)

Run tests from `backend/`: `.venv/bin/python -m pytest tutor/tests -q`.

### Task 4.1: Models and store

**Files:**
- Create: `backend/tutor/__init__.py`, `backend/tutor/models.py`, `backend/tutor/store.py`, `backend/tutor/seed.py`, `backend/tutor/tests/test_store.py`
- Modify: `backend/requirements.txt` (append `livekit-api>=1.2.3`, `python-dotenv>=1.0`, `pymongo>=4.8`, `pytest>=8`)

**Interfaces:**
- Produces (`models.py`, Pydantic): `LearnerProfile`, `Tutor{tutor_id, name, avatar_id, voice_id, style_prompt}`, `KP{kp_id, title, summary, prereq_ids, status: Literal["not_started","introduced","understood"]="not_started", evidence: str=""}`, `Material{kind: Literal["pdf","url","demo"], ref, dataset_title}`, `Track{track_id, user_id, title, materials, knowledge_points, created_at}`, `Struggle{kp_id, what, tried_explanations}`, `Worked{kp_id, explanation_style}`, `Lesson{lesson_id, track_id, tutor_id, started_at, ended_at: str|None, summary: str="", covered_kp_ids, struggles, worked, board_snapshot_ref: str|None}` — fields exactly as README §7.
- Produces (`store.py`): `class Store` with `get_profile(user_id) -> LearnerProfile`, `list_tutors() -> list[Tutor]`, `get_tutor(id) -> Tutor`, `list_tracks(user_id) -> list[Track]`, `get_track(id) -> Track`, `save_track(Track)`, `create_lesson(track_id, tutor_id) -> Lesson`, `get_lesson(id) -> Lesson`, `save_lesson(Lesson)`, `recent_lessons(track_id, n=3) -> list[Lesson]` (newest ended first). `def make_store() -> Store` returns the Mongo-backed store when `MONGODB_URI` is set, else JSON files under `backend/tutor/data/` (path overridable by `TUTOR_DATA_DIR` for tests).
- Produces (`seed.py`): demo user `demo` (style `visual`, level `undergrad`); three tutors, all with Kenji's verified live avatar `7572faa9-15da-400d-8227-ef1ab8932523` until Studio `av_` ids are converted (Task 0 Step 7 result) — `kenji-visual` (voice `JBFqnCBsd6RMkjVDRZzb` George, "visual explainer: draws first, then explains"), `kenji-socratic` (voice `pNInz6obpgDQGcFmaJgB` Adam, "Socratic coach: asks guiding questions before explaining"), `kenji-examples` (voice `nPczCjzI2devNBz1zQrb` Brian, "worked examples: solves a similar problem step by step, then lets you try"). Avatar ids live in one constant `TUTOR_AVATARS` so swapping faces is a one-line change. One track "Gradient Descent" with 4 KPs; applied on first use of an empty store.

- [ ] **Step 1: Write failing tests** in `test_store.py` (use `tmp_path` + `monkeypatch.setenv("TUTOR_DATA_DIR", ...)`):
  - `test_seed_on_empty_store`: `len(s.list_tutors()) == 3`, voice ids pairwise distinct, `s.list_tracks("demo")[0].title == "Gradient Descent"`.
  - `test_lesson_roundtrip`: create lesson → `save_lesson` with `summary="x"`, `ended_at` set → `recent_lessons(track_id)[0].summary == "x"`.
  - `test_recent_lessons_order_and_limit`: 5 ended lessons → returns 3, newest first; unended lessons excluded.
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement models, JSON store (one JSON file per collection, write via temp file + `os.replace`), Mongo store (same interface, collections `profiles`, `tutors`, `tracks`, `lessons`), seed.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(tutor-backend): models and store`.

### Task 4.2: Router — tutors, tracks, materials, context, progress, end

**Files:**
- Create: `backend/tutor/router.py`, `backend/tutor/tests/test_router.py`

**Interfaces:**
- Consumes: Task 4.1 `Store`, `make_store`; `schemas.WorkspaceDataset` (import only).
- Produces: `tutor_router = APIRouter(prefix="/api/tutor")` with:
  - `GET /tutors -> list[Tutor]`
  - `GET /tracks?user_id=demo -> list[Track]`, `POST /tracks {title, user_id="demo"} -> Track`, `GET /tracks/{track_id} -> {track: Track, lessons: list[Lesson]}` (last 3)
  - `POST /tracks/{track_id}/materials {kind, ref, dataset: WorkspaceDataset} -> Track` — KP id `f"m{material_index}:{node.id}"`, title=`node.label`, summary=`node.summary`, `prereq_ids` from edges with `type == "prerequisite"` (target's prereq = source, same prefix).
  - `GET /context/{lesson_id} -> {tutor: Tutor, profile: LearnerProfile, track: Track, recent_lessons: list[Lesson]}`
  - `POST /lessons/{lesson_id}/progress {kp_updates?: [{kp_id, status, evidence}], struggles?: [Struggle], worked?: [Worked]} -> Lesson` — updates track KPs and appends to lesson; unknown `kp_id` → 404 naming the id.
  - `POST /lessons/{lesson_id}/end {summary, covered_kp_ids, board_snapshot_ref?} -> Lesson` — sets `ended_at`; second call is a no-op returning the same lesson.
  - Router obtains the store via a FastAPI dependency `get_store()` so tests can override it.

- [ ] **Step 1: Write failing tests** with `TestClient` on a bare `FastAPI()` that includes `tutor_router` and overrides `get_store`:
  - `test_tutors_and_seed_track`: `GET /api/tutor/tutors` → 3 items.
  - `test_materials_prefix_and_empty`: post a dataset with nodes `n1,n2` + prerequisite edge `n1→n2` twice → KP ids include `m0:n1`, `m1:n1`; `m0:n2.prereq_ids == ["m0:n1"]`; posting a dataset with `nodes: []` → 200, KP count unchanged.
  - `test_progress_updates_kp_status`: status → `introduced`; `GET /tracks/{id}` shows it.
  - `test_progress_unknown_kp_404`.
  - `test_end_is_idempotent`: two calls → same `ended_at`.
  - `test_context_bundle`: keys `tutor, profile, track, recent_lessons`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `router.py`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(tutor-backend): tracks, materials, context, progress, end`.

### Task 4.3: Session endpoint and LiveKit token

**Files:**
- Create: `backend/tutor/livekit_token.py`, `backend/tutor/tests/test_session.py`
- Modify: `backend/tutor/router.py` (add `POST /session`)

**Interfaces:**
- Produces: `mint_token(*, room: str, identity: str, agent_name: str, metadata: dict) -> str` using `api.AccessToken(key, secret).with_identity(identity).with_grants(api.VideoGrants(room_join=True, room=room)).with_room_config(api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=agent_name, metadata=json.dumps(metadata))], sync_streams=True))`; keys from `LIVEKIT_API_KEY/SECRET`.
- Produces: `POST /api/tutor/session {track_id, tutor_id, user_id="demo"} -> {url, token, room, lesson_id}`; room `f"tutor-{lesson_id}"`, identity `f"student-{user_id}"`, metadata `{track_id, lesson_id, tutor_id}`, agent `TUTOR_AGENT_NAME` (default `synthesia-avatar-agent`). Missing LiveKit env → 503 `"LiveKit is not configured"`.
- Backend loads `backend/.env` via `python-dotenv` at router import.

- [ ] **Step 1: Write failing tests** (`monkeypatch.setenv` dummy `LIVEKIT_*`): `test_token_has_dispatch_and_sync` — decode with `api.TokenVerifier(key, secret).verify(token)`: `claims.identity == "student-demo"`, `claims.video.room == room`, `claims.room_config.sync_streams is True`, `claims.room_config.agents[0].agent_name == "tutor-test"`, `json.loads(...metadata)["lesson_id"] == lesson_id`; `test_session_503_without_env`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(tutor-backend): session token with agent dispatch`.

### Task 4.4: Mount the router

**Files:**
- Modify: `backend/main.py` — add `from tutor.router import tutor_router` next to the other imports and `app.include_router(tutor_router)` directly after the `app.add_middleware(...)` block. Nothing else.
- Create: `backend/.env.example` with `LIVEKIT_URL=`, `LIVEKIT_API_KEY=`, `LIVEKIT_API_SECRET=`, `TUTOR_AGENT_NAME=`, `MONGODB_URI=`

- [ ] **Step 1:** Edit as above.
- [ ] **Step 2:** Verify: `.venv/bin/uvicorn main:app --port 8001` then `curl -s localhost:8001/api/health` → `{"status":"ok",...}`; `curl -s localhost:8001/api/demo/lecture -o /dev/null -w "%{http_code}"` → `200`; `curl -s localhost:8001/api/tutor/tutors` → 3 tutors. `git diff --stat backend/main.py` → `2 insertions`.
- [ ] **Step 3:** Commit `feat(tutor-backend): mount tutor router`.

---

## WS2 — Whiteboard (`frontend/src/tutor/board/`)

Run tests from `frontend/`: `npm run test -- src/tutor/board`.

### Task 2.1: Op validation and layout engine (pure TS)

**Files:**
- Create: `frontend/src/tutor/board/ops.ts`, `frontend/src/tutor/board/layout.ts`, `frontend/src/tutor/board/ops.test.ts`, `frontend/src/tutor/board/layout.test.ts`

**Interfaces:**
- Produces (`ops.ts`): `type BoardOp` (discriminated union on `op`, mirroring the schema), `type ApplyResult = {ok: boolean; ids: string[]; errors: string[]}`, `validateOp(op: unknown, existingIds: Set<string>): {op: BoardOp} | {error: string}` — uses Ajv with `frontend/src/tutor/contracts/board_ops.schema.json` (import the JSON) and checks that `from_id`, `to_id`, `target_id`, and `below:/right_of:` ids exist.
- Produces (`layout.ts`): `type Box = {x:number;y:number;w:number;h:number}` (board units), `resolvePlace(place: string, size: {w:number;h:number}, occupied: Map<string, Box>): Box`. Rules: board is 1000×1000 units with 20-unit margin; `next` = first free slot scanning rows top-to-bottom, left-to-right; `below:<id>` = under the item, left-aligned, 20-unit gap; `right_of:<id>` = right of it, top-aligned; `region:x,y,w,h` = that box scaled to fit `size`. If a resolved box overlaps an occupied box or leaves the board, fall back to `next`.

- [ ] **Step 1: Write failing tests:**
  - `validates every example`: each op in `valid_ops.json` passes with all referenced ids pre-seeded; each in `invalid_ops.json` returns an `error`.
  - `rejects_unknown_target`: `{op:"highlight", target_id:"nope"}` → error containing `"nope"`.
  - `next fills rows without overlap`: 12 boxes of 300×150 → no pair overlaps, all inside `[20, 980]`.
  - `below and right_of place relative`: `below:a` → `y == a.y + a.h + 20`, `x == a.x`.
  - `falls back to next when off-board`: `right_of:a` with `a` at x=900 → result inside the board.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(board): op validation and layout`.

### Task 2.2: Whiteboard component and applyOps

**Files:**
- Create: `frontend/src/tutor/board/Whiteboard.tsx`, `frontend/src/tutor/board/shapes/MathShape.tsx`, `frontend/src/tutor/board/shapes/PlotShape.tsx`, `frontend/src/tutor/board/toShapes.ts`, `frontend/src/tutor/board/toShapes.test.ts`, `frontend/src/tutor/board/BoardHarness.tsx`

**Interfaces:**
- Consumes: Task 2.1 `BoardOp`, `validateOp`, `resolvePlace`.
- Produces (`toShapes.ts`): `opToShapePartials(op: BoardOp, box: Box, scale: number): TLShapePartial[]` — pure mapping; every created shape has `meta: {author: "tutor", boardId: <op.id or generated>, group?: string, step?: number}`. `write_text` → tldraw text/geo shape; `write_math` → custom `math` shape (KaTeX); `plot_function` → custom `plot` shape (function-plot); `draw_shape` → `geo`; `draw_arrow` → arrow bound to both shapes; `place_image` → image shape from URL; `reveal_step` → sets opacity 1 for shapes in `group` with `step ≤ n`, 0 otherwise.
- Produces (`Whiteboard.tsx`): `export type BoardHandle = { applyOps(ops: unknown[]): ApplyResult; describe(): BoardDescription; snapshot(region?: Box): Promise<string /* png base64 */>; setCircleMode(on: boolean): void }` and `<Whiteboard ref={BoardHandle} onCircle={(e: CircleEvent) => void} />` (`forwardRef`). User-drawn shapes get `meta.author = "user"`. `applyOps` validates each op, applies valid ones, never throws.
- Verify the installed tldraw 5.6 API names (`createShapes`, custom `ShapeUtil`, `toImage`) in `node_modules/tldraw` before coding.

- [ ] **Step 1: Write failing tests** (`toShapes.test.ts`): `math op maps to math shape with latex prop`; `reveal_step hides later steps` (3 shapes in group `g`, step 2 → opacities `[1,1,0]`); `every shape carries author tutor`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `toShapes.ts`, custom shapes, `Whiteboard.tsx`. **Step 4:** Run → PASS.
- [ ] **Step 5:** Build `BoardHarness.tsx` (client component) that mounts `Whiteboard` and plays `valid_ops.json` with a 500 ms delay per op. Temporarily render it from a scratch route outside the repo's tracked files, or via Task 3.3's page once available; screenshot: equation, plot, arrow, 3-step reveal and image all readable, nothing overlapping.
- [ ] **Step 6:** Commit `feat(board): tldraw whiteboard with tutor ops`.

### Task 2.3: Describe, snapshot and Circle-to-Ask

**Files:**
- Create: `frontend/src/tutor/board/describe.ts`, `frontend/src/tutor/board/circle.ts`, `frontend/src/tutor/board/describe.test.ts`, `frontend/src/tutor/board/circle.test.ts`
- Modify: `frontend/src/tutor/board/Whiteboard.tsx` (wire them in)

**Interfaces:**
- Produces: `type BoardItem = {id: string; type: string; author: "tutor"|"user"; text?: string; latex?: string; label?: string; bbox: Box}`, `type BoardDescription = {items: BoardItem[]}`, `describeShapes(shapes: TLShape[], toBoardUnits: (b) => Box): BoardDescription` (user freehand → `{type: "ink"}`; text truncated to 120 chars).
- Produces: `type CircleEvent = {png_b64: string; region: Box; item_ids: string[]; user_text?: string; source: "board" | "screen"}` (the whiteboard always emits `"board"`), `itemsInRegion(items: BoardItem[], region: Box): string[]` (an item counts if ≥ 50% of its bbox area is inside), `downscaleDims(w: number, h: number, max = 1024): {w:number; h:number}`.
- Circle mode: lasso with tldraw's draw tool into a temporary shape; its bounds → region; `snapshot(region)` → PNG at ≤ 1024 px long side; temporary shape removed; `onCircle(event)` fired.

- [ ] **Step 1: Write failing tests:** `describe marks user ink`; `describe truncates long text`; `itemsInRegion uses 50% rule`; `empty region yields no items`; `downscales large crops` (`downscaleDims(4000, 1000)` → `{w:1024, h:256}`; `(500, 300)` unchanged).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and wire. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(board): describe, snapshot and circle capture`.

### Task 2.4: RPC handlers and public exports

**Files:**
- Create: `frontend/src/tutor/board/rpc.ts`, `frontend/src/tutor/board/rpc.test.ts`, `frontend/src/tutor/board/index.ts`

**Interfaces:**
- Produces: `makeBoardRpcHandlers(getBoard: () => BoardHandle | null): Record<"board.apply"|"board.describe"|"board.snapshot", (payload: string) => Promise<string>>`. Payloads/replies are JSON strings per README §8: `board.apply` `{ops}` → `ApplyResult`; `board.describe` `{}` → `BoardDescription`; `board.snapshot` `{region?}` → `{png_b64}`. Malformed JSON or no board → reply `{ok:false, errors:["..."]}` (never throw).
- `index.ts` exports `Whiteboard`, `BoardHandle`, `CircleEvent`, `BoardDescription`, `makeBoardRpcHandlers`.

- [ ] **Step 1: Write failing tests** with a fake `BoardHandle`: `apply forwards ops and returns result`; `malformed payload returns error json`; `null board returns error json`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(board): rpc handlers and exports`.

---

## WS1 — Tutor agent (`agent/`)

Run tests from `agent/`: `uv run pytest -q`.

### Task 1.1: Scaffold and instruction builder

**Files:**
- Create: `agent/pyproject.toml` (deps: `livekit-agents[anthropic,elevenlabs,silero]~=1.8`, `livekit-plugins-synthesia~=1.8`, `python-dotenv`, `httpx`, `jsonschema`; dev: `pytest`, `pytest-asyncio`), `agent/uv.lock`, `agent/.env.example` (keys from README §8), `agent/prompting.py`, `agent/tests/test_prompting.py`, `agent/tests/fixtures/context.json`

**Interfaces:**
- Consumes: `GET /api/tutor/context/{lesson_id}` shape (Task 4.2) — fixture copies it.
- Produces: `build_instructions(ctx: dict) -> str`. Must contain, in this order: the tutor's `style_prompt`; fixed rules (1–3 spoken sentences, no markdown, put detail on the board via tools, call `look_at_board` before answering about "this/here", never claim a drawing/progress update succeeded unless the tool returned ok, when re-explaining after confusion pick a different style from those listed as tried: analogy → diagram → worked example → simpler prerequisite; after explaining a knowledge point, ask one short check question, ask the student to answer on the board, then call `look_at_board` on their answer and respond; if interrupted, address what the student said before continuing); learner profile line; KP list as `- <kp_id> [<status>] <title>`; "Last lessons:" with each recent summary, struggles (`kp_id: what — tried: ...`) and what worked.
- Produces: `greeting_instruction(ctx: dict) -> str` — "Greet the student by name in one sentence; if there is a last lesson, mention one thing from it."

- [ ] **Step 1: Write failing tests:** `test_instructions_include_style_and_kps` (fixture KP `m0:n1` and its status appear; style prompt is first line); `test_instructions_list_tried_explanations`; `test_greeting_mentions_last_lesson_when_present` / `..._absent`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(agent): scaffold and instruction builder`.

### Task 1.2: Tool wrappers (board + progress)

**Files:**
- Create: `agent/tutor_tools.py`, `agent/tests/test_tutor_tools.py`

**Interfaces:**
- Produces: `class TutorIO(Protocol)`: `async def rpc(self, method: str, payload: dict) -> dict`, `async def post(self, path: str, body: dict) -> dict`, and `def latest_screen_frame(self) -> str | None` (base64 JPEG of the newest screen-share frame, `None` when not sharing).
- Produces: `class TutorTools` constructed with `(io: TutorIO, lesson_id: str)`, exposing LiveKit `@function_tool` methods for an `Agent` subclass (Task 1.5) and plain async methods for tests:
  - `board_write(ops: list[dict]) -> str` — validates each op with `jsonschema` against `frontend/src/tutor/contracts/board_ops.schema.json` (path relative to the repo, resolved from `agent/`); invalid ops are dropped and reported; valid ones go to `rpc("board.apply", {"ops": ...})`; returns `"ok: drew <ids>"` or `"partial: drew <ids>; failed: <errors>"` or `"failed: <errors>"`.
  - `look_at_board(region: dict | None = None) -> str | tuple[str, str]` — `board.describe` → compact text (`<id> <type> <author>: <text|latex|label>`, one per line); with `region`, also `board.snapshot` → returns `(text, png_b64)` for the caller to attach as an image.
  - `mark_progress(kp_id: str, status: Literal["introduced","understood"], evidence: str) -> str`, `note_struggle(kp_id, what, tried: list[str]) -> str`, `note_worked(kp_id, style) -> str` → `post(f"/api/tutor/lessons/{lesson_id}/progress", ...)`; HTTP 404 → `"failed: unknown kp <id>"`.
  - `look_at_screen() -> str | tuple[str, str]` → `"no screen is being shared"` or `("latest frame of the student's shared screen", jpeg_b64)` for the caller to attach as an image.
  - `start_visual(kind: Literal["illustration","animation"], brief: str) -> str` → returns `"queued"` immediately and schedules `agent.workers.run_visual(kind, brief, board_text)` (Task 5.x) as a background task; if the import fails returns `"not available"`.

- [ ] **Step 1: Write failing tests** with a fake `TutorIO`: `test_board_write_validates_and_forwards`; `test_board_write_reports_errors` (fake page returns `{ok:false, errors:["unknown target x"]}` → result starts `"failed"`); `test_invalid_op_never_sent`; `test_look_at_board_formats_items`; `test_look_at_screen_without_share`; `test_look_at_screen_returns_frame`; `test_mark_progress_404_message`; `test_start_visual_returns_immediately` (worker coroutine sleeps 1 s; call returns in < 50 ms).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(agent): board and progress tools`.

### Task 1.3: Circle and "I'm lost" events → new user turns

**Files:**
- Create: `agent/circle.py`, `agent/tests/test_circle.py`

**Interfaces:**
- Produces: `circle_message(payload: dict, board_text: str) -> llm.ChatMessage` — role `user`, content `[text, ImageContent(image=f"data:image/png;base64,{png_b64}")]`; text = `"[circled on <source>] items=<ids or 'none'> said=\"<user_text or ''>\" board:\n<board_text>\nRe-explain what I circled in a different way than what's already on the board."` (`source` defaults to `board`).
- Produces: `lost_message(last_spoken: str) -> llm.ChatMessage` — role `user`, text `"[I'm lost] You were saying: \"<last ~200 chars of last_spoken>\". I got lost there. Check what I'm missing and explain it differently."`.
- Produces: `async def handle_circle(agent, session, payload: dict, board_text: str) -> None` and `async def handle_lost(agent, session) -> None` — both: `session.interrupt()` if the tutor is speaking, copy `agent.chat_ctx`, append the message, `await agent.update_chat_ctx(ctx)`, `session.generate_reply()`. `handle_lost` takes `last_spoken` from the last assistant message in `agent.chat_ctx` (LiveKit truncates it to what was actually spoken).

- [ ] **Step 1: Write failing tests:** `test_circle_message_has_image_and_items`; `test_circle_message_without_items_says_none`; `test_circle_message_names_screen_source`; `test_lost_message_quotes_last_spoken` (600-char input → only the last 200 chars quoted).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(agent): circle and lost events`.

### Task 1.4: Rolling lesson context

**Files:**
- Create: `agent/rolling.py`, `agent/tests/test_rolling.py`

**Interfaces:**
- Produces: `class RollingSummary(summarize: Callable[[str, list[str]], Awaitable[str]], keep_last: int = 10, fold_every: int = 6)` with `add_turn(role: str, text: str) -> None`, `async maybe_fold() -> bool` (when more than `keep_last + fold_every` turns are held, folds the oldest into `summary` via `summarize(previous_summary, old_turns)` and drops them), `summary: str`, `recent: list[str]`.
- Produces: `async def haiku_summarize(prev: str, turns: list[str]) -> str` (Anthropic SDK, `claude-haiku-5-5`, ≤ 200 tokens) — used in Task 1.5; not called in unit tests.
- Task 1.5 calls `maybe_fold()` as a background task after each assistant turn and injects `summary` as a system message replacing the previous one; the LiveKit chat context is truncated to the last `keep_last` turns.

- [ ] **Step 1: Write failing tests** with a fake summarizer: `test_no_fold_below_threshold`; `test_fold_keeps_last_n_and_updates_summary`; `test_fold_passes_previous_summary`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(agent): rolling lesson summary`.

### Task 1.5: Entrypoint wiring, voice-only mode, end of lesson

**Files:**
- Create: `agent/agent.py`, `agent/lesson_end.py`, `agent/tests/test_lesson_end.py`

**Interfaces:**
- Consumes: Tasks 1.1–1.4; backend `/context`, `/end`; dispatch metadata `ctx.job.metadata` = `{"track_id","lesson_id","tutor_id"}`.
- Produces: worker `cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=os.environ.get("TUTOR_AGENT_NAME", "synthesia-avatar-agent")))`.
- Entrypoint: connect; parse metadata; fetch context; `AgentSession(stt=elevenlabs.STT(model="scribe_v2_realtime"), llm=anthropic.LLM(model="claude-haiku-5-5", caching="ephemeral", max_tokens=300), tts=elevenlabs.TTS(voice_id=ctx["tutor"]["voice_id"], model="eleven_flash_v2_5"), vad=silero.VAD.load(), preemptive_generation=True, use_tts_aligned_transcript=True, turn_handling=TurnHandlingOptions(...))` with interruptions enabled and a short minimum interruption duration (~0.3 s; verify field names in the installed 1.8.12 — the old `allow_interruptions`/`min_interruption_duration` kwargs are deprecated in favour of `TurnHandlingOptions`); room input with video enabled (screen share) — keep the latest screen-share frame (`rtc.TrackSource.SOURCE_SCREENSHARE`) in memory and encode it with `livekit.agents.utils.images.encode` only when `look_at_screen` asks; unless `TUTOR_AVATAR == "0"`, start `synthesia.AvatarSession(AvatarConfig(avatar_ids=[ctx["tutor"]["avatar_id"]]))` **before** `session.start`; `TutorAgent(Agent)` with `instructions=build_instructions(ctx)` and the `TutorTools` function tools; `TutorIO` implementation = `ctx.room.local_participant.perform_rpc(destination_identity=<student identity>, ...)` + `httpx` to `TUTOR_API_BASE`; student identity = first remote participant whose identity starts with `student-`; register text stream handlers on topic `tutor.circle` → `handle_circle` and `tutor.lost` → `handle_lost`; greet with `greeting_instruction(ctx)`.
- Produces (`lesson_end.py`): `class LessonEnder(post: Callable[[str, dict], Awaitable[dict]], lesson_id: str)` with `async end(summary: str, covered_kp_ids: list[str]) -> None` that posts `/api/tutor/lessons/{id}/end` exactly once even if called twice concurrently. `entrypoint` registers `ctx.add_shutdown_callback` → final `haiku_summarize` of the rolling summary + recent turns → `end(...)`. `covered_kp_ids` = KPs marked via `mark_progress` during the session.

- [ ] **Step 1: Write failing tests:** `test_shutdown_posts_end_once` (two concurrent `end()` calls → one post); `test_end_payload_has_summary_and_kps`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `lesson_end.py` and `agent.py`. **Step 4:** Run → PASS.
- [ ] **Step 5: Smoke test (voice only).** With Task 4.x backend running and `TUTOR_AVATAR=0`: `uv run agent.py dev`; create a session via `curl -s -XPOST localhost:8000/api/tutor/session -H 'content-type: application/json' -d '{"track_id":"<seed id>","tutor_id":"kenji-visual"}'`; the agent log shows `received job request` with the lesson metadata and a greeting `conversation_item_added` within ~3 s; delete the room with `lk room delete tutor-<lesson_id>` → log shows the `/end` POST returning 200. Interruption check (with Task 3.3 page, Safari): ask for a long explanation, speak over it → tutor audio stops within ~300 ms and the next reply answers what you said.
- [ ] **Step 6:** Commit `feat(agent): tutor entrypoint, voice-only mode, lesson end`.

---

## WS3 — Tutor app shell (`frontend/src/app/tutor/`, `frontend/src/tutor/shell/`)

Run tests from `frontend/`: `npm run test -- src/tutor/shell`.

### Task 3.1: Typed API client

**Files:**
- Create: `frontend/src/tutor/shell/api.ts`, `frontend/src/tutor/shell/api.test.ts`

**Interfaces:**
- Produces: TS types mirroring Task 4.1 models (`Tutor`, `Track`, `KP`, `Lesson`) and functions using `const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000"`: `listTutors()`, `listTracks()`, `createTrack(title)`, `getTrack(id) -> {track, lessons}`, `addMaterial(trackId, {kind, ref, dataset})`, `ingestPdf(file: File, mode="lecture") -> WorkspaceDataset` (team's `POST /api/ingest/pdf`, form fields as the team's `UploadModal` sends them), `ingestUrl(url, mode="lecture")`, `startSession(trackId, tutorId) -> {url, token, room, lesson_id}`. Non-2xx → throws `Error` with the response's `detail`.

- [ ] **Step 1: Write failing tests** with mocked `fetch`: `startSession posts track and tutor`; `non-2xx throws detail` (503 `"LiveKit is not configured"`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(tutor-shell): api client`.

### Task 3.2: `useTutorSession` hook

**Files:**
- Create: `frontend/src/tutor/shell/useTutorSession.ts`, `frontend/src/tutor/shell/session.ts`, `frontend/src/tutor/shell/session.test.ts`

**Interfaces:**
- Consumes: Task 2.4 `makeBoardRpcHandlers`, `CircleEvent`, `BoardHandle`; Task 3.1 `startSession`.
- Produces (`session.ts`, framework-free, testable with a fake room): `type RoomLike` (the subset of `livekit-client` `Room` used: `connect`, `disconnect`, `registerRpcMethod`, `localParticipant.setMicrophoneEnabled / setCameraEnabled / setScreenShareEnabled / sendText`, `on/off` for participant, track and transcription events — verify names against installed `livekit-client` 2.24), `async connectLesson(room: RoomLike, s: {url, token}, getBoard): Promise<void>` (connect with `adaptiveStream: false`, register the three board RPCs, enable mic), `sendCircle(room, e: CircleEvent): Promise<void>` (`sendText(JSON.stringify(e), {topic: "tutor.circle"})`), `sendLost(room): Promise<void>` (`sendText("{}", {topic: "tutor.lost"})`), `waitForAgent(room, timeoutMs = 20000): Promise<void>` (resolves when a participant with identity not starting `student-` joins; rejects with `"Tutor didn't join — is the agent running?"`), `mergeCaption(list, seg: {id, who, text, final}) -> list` (updates an in-progress segment by id instead of appending duplicates).
- Produces (`useTutorSession.ts`): `useTutorSession(boardRef) -> {status: "idle"|"connecting"|"live"|"error", error?: string, lessonId?: string, avatarVideo?: RemoteVideoTrack, selfVideo?: LocalVideoTrack, screenTrack?: LocalVideoTrack, captions: {id: string; who: "tutor"|"you"; text: string; final: boolean}[], start(trackId, tutorId), end(), sendCircle(e), sendLost(), sendText(t), mic: boolean, toggleMic(), cam: boolean, toggleCam(), sharing: boolean, toggleShare()}`; avatar video = track of participant `synthesia-avatar-agent`; camera is published for self-view only (the agent ignores camera tracks); `end()` and `beforeunload` disconnect.

- [ ] **Step 1: Write failing tests** with a fake `RoomLike`: `registers all board rpcs on connect`; `sendCircle uses tutor.circle topic`; `sendLost uses tutor.lost topic`; `times out when no agent joins` (fake timers, 20 s → rejects with the exact message); `resolves when agent joins`; `mergeCaption updates interim segment in place`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(tutor-shell): lesson session hook`.

### Task 3.3: `/tutor` page — Zoom/Teams-style lobby and call view

**Files:**
- Create: `frontend/src/app/tutor/page.tsx`, `frontend/src/tutor/shell/Lobby.tsx`, `frontend/src/tutor/shell/CallView.tsx`, `frontend/src/tutor/shell/Stage.tsx`, `frontend/src/tutor/shell/VideoTiles.tsx`, `frontend/src/tutor/shell/ControlBar.tsx`, `frontend/src/tutor/shell/SidePanel.tsx`, `frontend/src/tutor/shell/CaptionsOverlay.tsx`, `frontend/src/tutor/shell/page.test.tsx`

**Interfaces:**
- Consumes: Task 2.4 exports, Tasks 3.1–3.2.
- Layout per README §4 (Tailwind, same slate/sky palette as `/`):
  - `Lobby`: tutor cards (name, style, avatar preview image or initials), track dropdown + "New track", mic level meter and camera preview, **Join lesson** (disabled until tutor and track are chosen).
  - `CallView`: `Stage` (tabs **Whiteboard** | **Shared screen**; auto-switches to Shared screen when sharing starts) · `VideoTiles` (tutor tile large with name label and speaking ring; self-view tile small, mirrored; voice-only placeholder = pulsing ring with the tutor's name) · `CaptionsOverlay` (last 2 lines over the stage, toggled by CC) · `SidePanel` tabs **Transcript** (full captions history) | **Lesson** (KPs with status chips, "Last time" summary, end-of-lesson recap after Leave) | **Materials** · `ControlBar`: Mic, Camera, Share screen, Board, Circle, **I'm lost** (`sendLost`), CC, text input (fallback), **Leave** (red).
- `SidePanel` Lesson tab polls `getTrack(trackId)` every 4 s while live.

- [ ] **Step 1: Write failing tests** (`page.test.tsx`, mocked api + hook): `lobby disables Join until tutor and track are picked`; `shows the error message when start fails`; `control bar has Leave and I'm lost, and I'm lost calls sendLost`; `CC toggles the captions overlay`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Manual check (Safari):** `npm run dev` → `http://localhost:3000/tutor` shows the lobby with 3 tutors and the seeded track; with the agent stopped, Join → error after 20 s; with the agent running: tutor tile shows the avatar, captions appear for both sides, speaking over the tutor stops it; `/` unchanged.
- [ ] **Step 6:** Commit `feat(tutor-shell): zoom-style lesson page`.

### Task 3.5: Circle on the shared screen

**Files:**
- Create: `frontend/src/tutor/shell/ScreenCircle.tsx`, `frontend/src/tutor/shell/screenCircle.test.ts`
- Modify: `frontend/src/tutor/shell/Stage.tsx`

**Interfaces:**
- Consumes: Task 2.3 `CircleEvent`, `downscaleDims`; Task 3.2 `sendCircle`.
- Produces: `cropVideoFrame(video: HTMLVideoElement, region: {x,y,w,h} /* element px */) -> string /* png base64 */` (draws the current frame to a canvas at the video's intrinsic resolution, crops, downscales with `downscaleDims`), and `<ScreenCircle video={...} onCircle={(e: CircleEvent) => void} />` — a transparent lasso overlay active when Circle mode is on and the Shared screen tab is shown; emits `{png_b64, region, item_ids: [], source: "screen"}`.

- [ ] **Step 1: Write failing test:** `maps element-px region to intrinsic video px` (element 640×360 showing a 1920×1080 video, region `{x:320,y:180,w:160,h:90}` → source rect `{x:960,y:540,w:480,h:270}`) — test the pure helper `toIntrinsic(region, elementSize, videoSize)`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Manual check:** share a window with an equation, circle it, ask "what's this?" → the tutor describes the circled equation.
- [ ] **Step 6:** Commit `feat(tutor-shell): circle on shared screen`.

### Task 3.4: Upload material into a track

**Files:**
- Create: `frontend/src/tutor/shell/AddMaterial.tsx`
- Modify: `frontend/src/tutor/shell/TracksSidebar.tsx`

**Interfaces:**
- Consumes: Task 3.1 `ingestPdf`, `ingestUrl`, `addMaterial`.
- "Add material" on a track: PDF file or URL → team ingest → `addMaterial` → refresh track; show "Added N knowledge points" (N may be 0).

- [ ] **Step 1:** Implement. **Step 2: Manual check:** upload a small PDF → KP list grows; URL path works; ingest error shows the backend's `detail`.
- [ ] **Step 3:** Commit `feat(tutor-shell): add material to track`.

---

## WS5 — Slow workers (`agent/workers/`) — Should tier

Run tests from `agent/`: `uv run pytest workers/tests -q`.

### Task 5.1: Illustration worker (fal)

**Files:**
- Create: `agent/workers/__init__.py`, `agent/workers/illustrate.py`, `agent/workers/tests/test_illustrate.py`
- Modify: `agent/pyproject.toml` — add `fal-client` (only dependency line; coordinate with WS1 at merge)

**Interfaces:**
- Produces (`__init__.py`): `async def run_visual(kind: Literal["illustration","animation"], brief: str, board_text: str) -> list[dict]` — dispatches to `illustrate` / `animate`; returns board ops (contract-valid).
- Produces: `async def illustrate(brief: str, *, client=None, timeout_s: float = 5.0) -> list[dict]` → `[{"op":"place_image","url":...,"caption":brief[:60],"place":"next"}]` using fal's fast FLUX model via `fal_client` (`FAL_KEY`); timeout/error → `[{"op":"write_text","text":"(sketch unavailable — let me describe it)","place":"next"}]`.

- [ ] **Step 1: Write failing tests** (fake client): `returns place_image op on success`; `falls back to text on timeout` (fake sleeps 6 s, `timeout_s=0.1`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(workers): fal illustration`.

### Task 5.2: Animation planner (Claude Sonnet)

**Files:**
- Create: `agent/workers/animate.py`, `agent/workers/tests/test_animate.py`

**Interfaces:**
- Produces: `async def animate(brief: str, board_text: str, *, client=None, timeout_s: float = 8.0) -> list[dict]` — asks `claude-sonnet-5-5` (tool-use with the board-op JSON Schema as the tool input schema) for 3–6 steps sharing one `group` id; post-validates with `jsonschema`; returns the ops followed by `reveal_step` ops `1..n`. Invalid ops dropped; nothing valid or timeout → `[{"op":"write_text","text":"(animation unavailable)","place":"next"}]`.
- The agent applies the returned ops via `board_write` and adds a system note "Visual ready: <brief>" so the tutor can say "here it is".

- [ ] **Step 1: Write failing tests** (fake Anthropic client): `returns ops plus reveal steps`; `drops invalid ops`; `falls back on timeout`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(workers): animation planner`.

---

## Integration (coordinator)

### Task 6.1: Merge and link

**Files:**
- Modify (merge only): branches `phase3/ws4-backend`, `phase3/ws2-board`, `phase3/ws1-agent`, `phase3/ws5-workers`, `phase3/ws3-shell` into `phase3/base`, in that order.
- Modify: `frontend/src/app/page.tsx` — one header link `<Link href="/tutor">Live Tutor</Link>`, **only after the page owner agrees**.
- Create: `phase3-live-tutor/run.sh` — starts backend (`backend/.venv/bin/uvicorn main:app --port 8000`), frontend (`npm run dev`) and agent (`cd agent && uv run agent.py dev`) with Ctrl-C cleanup (same pattern as `start.sh`, which stays untouched).

- [ ] **Step 1:** Merge in order; resolve only `agent/pyproject.toml` (WS1 + WS5 dependency lines).
- [ ] **Step 2:** Verify: `git diff phase3/base~N --stat` (vs pre-merge) touches only owned paths + `backend/main.py` (2 lines) + `backend/requirements.txt` + `frontend/package*.json`.
- [ ] **Step 3:** All suites green: `backend: .venv/bin/python -m pytest tutor/tests -q`; `agent: uv run pytest -q`; `frontend: npm run test && npm run build`.
- [ ] **Step 4:** Commit `chore(phase3): integrate workstreams`.

### Task 6.2: Cross-check

- [ ] **Step 1:** Run every box in MASTER_PROMPT §4 against the running system (voice-only first, then once with the avatar in Safari). Record each result in `phase3-live-tutor/CROSS_CHECK.md` (✅/❌ + one line).
- [ ] **Step 2:** For each ❌, fix in the owning workstream's files, rerun that suite and the failed check.
- [ ] **Step 3:** Delete leftover LiveKit rooms (`lk room list` → `lk room delete`).
- [ ] **Step 4:** Commit `test(phase3): cross-check results`.

### Task 6.3: Demo dry-run

- [ ] **Step 1:** Run README §10 script end to end twice in a row in Safari with the avatar, no restarts between runs.
- [ ] **Step 2:** Note timings (first word latency, circle → re-explain latency) in `CROSS_CHECK.md`.
- [ ] **Step 3:** Freeze: tag `phase3-demo` locally. Pushing and merging into the team's main branch is a team decision.
