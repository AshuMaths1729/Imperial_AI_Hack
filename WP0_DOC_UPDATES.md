# WP0 doc updates (ready to paste)

The WP0 worktree did not touch `implementation_guide.md` or `CLAUDE.md`. Apply the text below to the up-to-date copies in the main checkout, then delete this file.

---

## (a) `implementation_guide.md` §3.3 (implementation-agnostic wording)

Make these edits in §3.3 "Shared contracts":

1. **Route prefix.** Add one line under the heading: *All HTTP routes are served under the `/api` prefix; the endpoint tables and examples below omit it (`POST /ask-spatial` is `POST /api/ask-spatial`).*

2. **Graph JSON, optional extras.** After the schema block add: *Optional extras: a node may carry `authors_year` (paper nodes, for display). `source_ref` is omitted for nodes with no source document (for example an untested-gap claim). Node coordinates are never part of the contract; the frontend lays graphs out. Quiz and mastery data do not live on graph nodes; they are served by the quiz endpoints.* Also note that `gap` edges connect existing claim/paper nodes (there is no separate "gap" node kind).

3. **Simulation contract, optional extras.** After the `simulate` contract add: *Series may carry an optional display `color`. A simulation payload shown to the UI may also carry optional `equation_latex`, `paper_title`, `arxiv_id`, `python_code` and a precomputed `default_output` (the output at default parameters, so the plot renders before any runtime has loaded).*

4. **`/ask-spatial`, annotation `space`.** Replace the last paragraph about annotation types with:
   *Annotation types: `pulse_node` and `highlight_edge` (carry a node/edge `id`), `draw_arrow`, `circle_region` and `callout_box` (positional), and `show_card` (open an inspector card). Every positional annotation carries a `space`: `node` (anchored to a node or edge id via `target_id`), `data` (plot data coordinates) or `view` (normalised 0-1 within the captured view, origin top-left). Rectangles (`circle_region`) give `x`, `y` (top-left) and `w`, `h`. The response may also carry an optional `avatar_state` (`explaining` | `emphatic` | `questioning`). `follow_up` is optional.* Update the example annotation to `{ "type": "draw_arrow", "space": "data", "x": 3.0, "y": 0.4, "label": "Inflection point" }`.

5. **Job events.** In the endpoint table, change the `GET /jobs/{id}/events` row to: *Progress events `{seq, stage, pct, message?, result_id?}` (`pct` is 0-100). Every job ends with exactly one terminal event, `{stage: "done" | "error", result_id?}`; `error` carries the reason in `message`. Clients may resume with the `Last-Event-ID` header or a `last_event_id` query parameter.*

6. **Health.** Add a row: `GET /health` → `{status, cache_mode, preset}` — `cache_mode` is `live` | `offline` | `refresh`, `preset` is the loaded Demo Preset or null. The UI's offline badge reads it.

7. **Errors.** Add one line: *Every error response has the shape `{"error": {"code", "message", "details"?}}`.*

---

## (b) `CLAUDE.md` "Current state" section

Replace the whole "Current state" section, including "Commands" and "What is implemented today", with the text between the four-backtick fences:

````markdown
## Current state

Hackathon project (Imperial AI Hack): **ScholarTwin**. WP0 (foundation) is in: a uv-managed FastAPI backend with the module layout and shared schemas below, shared fixtures, and the Phase-1 Next.js frontend still running against the legacy routes. Real LLM, broker, job SSE and sponsor-tool integrations arrive with the parallel lanes (see the plan). Docs: `idea.md`, `implementation_guide.md` (authoritative; guide-editing rule above), `README.md`.

### Commands

```bash
./start.sh                       # or .\start.ps1 on Windows: backend :8000 + frontend :3000

# Backend (from backend/; uv installs Python 3.12 and the deps)
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest -q                 # fixtures, schemas, smoke tests (live tests use @pytest.mark.live)
uv run ruff check .

# Shared types (after changing routes or app/schemas)
uv run python scripts/export_openapi.py     # -> schemas/openapi.json
cd ../frontend && npm run gen:types         # -> src/api/types.gen.ts

# Frontend (from frontend/)
npm install && npm run dev       # next dev;  npm run build (webpack);  npm run lint
npx next typegen                 # needed once before `npx tsc --noEmit` on a fresh clone
```

Notes: `.env` (copy `.env.example`) is gitignored. Never re-add `backend/.venv`. The lint config enforces `react-hooks/set-state-in-effect` (two existing violations are fixed by Track D0). Next here is v16 / React 19 / Tailwind 4: read `frontend/node_modules/next/dist/docs/` before writing Next code.

### Backend layout and module convention

- `backend/app/main.py` `create_app()` auto-discovers every package in `app/modules/`, mounts its `router` under `/api` and calls its optional `register(reg)` (adds tools, route policies, MCP servers, extractors, sandbox runners to the shared `Registry`). `fixtures_api` and `legacy` are always mounted last, so a real route with the same path wins.
- Modules may import only `app.schemas`, `app.core`, `app.llm`, `app.tools`, `app.deps`; never each other. All external I/O goes through the broker; pipelines are lists of named stages run by the job runner.
- `app/schemas/` is the contract (Pydantic v2, `extra="forbid"`); `fixtures/` holds shared samples validated by `tests/test_fixtures.py`. `app/deps.py` provides `get_settings/get_cache/get_jobs/get_broker/get_llm/get_extractor`; `app/container.py` is where each swap point is wired (cache, jobs, broker, llm are fakes/simple implementations until C1-C3 land). Tests use `FakeBroker` / `FakeLLM` / `FakeExtractor`.
- `app/modules/legacy` (Phase-1 routes and old shapes) and `app/modules/fixtures_api` (fixture stand-ins: `/api/graphs/{id}`, `/api/sim/{id}`, `/api/jobs/{id}/events`, `/api/ask-spatial/v2`) are temporary; remove routes as the real ones land.
````

Also update the "Known drift" section: the endpoints are still `/api/...` by decision (documented in §3.3 above); the legacy shapes it lists are now confined to `app/modules/legacy`, and the new-shape equivalents live in `app/schemas/`.
