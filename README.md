# ScholarTwin — Imperial AI Hackathon

An interactive multimodal AI research & learning workspace that unifies **LectureGraph**, **Paper2Sim**, and **HypothesisGraph** into a single 3-pane canvas with **Circle-to-Ask** spatial tutoring and a reactive digital avatar.

## Core Modules (Unified 3-Pane Workspace)

- **LectureGraph (Understand):** Concept & prerequisite knowledge graph with slide/timestamp anchors and adaptive MCQs.
- **Paper2Sim (Reproduce):** Extracts paper equations into sandboxed Python simulations with live parameter sliders and interactive plots.
- **HypothesisGraph (Verify):** Maps supporting vs. contradictory claims across papers (`supports`, `contradicts`, `gap`) and surfaces untested research gaps.
- **Circle-to-Ask Avatar:** Toggle the lasso overlay on any graph or plot, circle a region, and ask via voice or text for synchronized explanations and UI annotations.

## Quick Start

Prerequisites: [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for you) and Node 20+.

Run both the FastAPI backend (`http://127.0.0.1:8000`) and Next.js frontend (`http://localhost:3000`):

```bash
./start.sh          # macOS / Linux / Git Bash
./start.ps1         # Windows PowerShell
```

### Manual Setup (if needed)

```bash
# Backend (Python deps are managed by uv: backend/pyproject.toml + uv.lock)
cd backend
uv sync                                        # creates backend/.venv with Python 3.12
uv run uvicorn app.main:app --reload --port 8000
uv run pytest -q                               # tests
uv run ruff check .                            # lint

# Frontend
cd frontend
npm install
npm run dev
```

API keys and settings go in a `.env` file (copy `.env.example`, names only; never commit it).

### Live avatar tutor

The live Synthesia/LiveKit tutor (left tutor box and `/tutor`) needs LiveKit keys in `.env` and its
agent worker running next to `./start.sh`: `cd agent && uv run avatar_agent.py dev`.
Full setup, per-developer agent names and troubleshooting: [`agent/README.md`](agent/README.md).

### Shared types

The backend's Pydantic models are the contract. After changing routes or `backend/app/schemas/`:

```bash
cd backend && uv run python scripts/export_openapi.py   # writes schemas/openapi.json
cd frontend && npm run gen:types                         # writes src/api/types.gen.ts
```

## Project Structure

- `backend/app/` — FastAPI app: `main.py` (`create_app()`, auto-discovers `modules/*`), `settings.py`, `deps.py`, `schemas/` (shared contracts), `core/` (cache, jobs, errors), `llm/`, `tools/` (broker, registry), `modules/` (one package per feature; `legacy` holds the Phase-1 prototype routes, `fixtures_api` serves the shared fixtures).
- `fixtures/` — shared JSON samples (lecture/hypothesis graphs, simulation, ask-spatial answers, job events) validated against the schemas by the tests.
- `schemas/openapi.json` — generated OpenAPI document (source of the frontend types).
- `frontend/` — Next.js + Tailwind CSS + React Flow 3-pane workspace (`AvatarDock`, `GraphCanvas`, `PaperSimCanvas`, `LassoOverlay`, `InspectorPane`).
- `start.sh` / `start.ps1` — Launch backend and frontend together with clean `Ctrl+C` shutdown.
- `implementation_guide.md` — Full hackathon architecture and phase roadmap.

## Sponsor / Tool Stack Notes

- `synthesia`: avatar and video/graphic creation (pre-rendered clips)
- `tavily`: web crawl and search
- `figma`: UI design
- `adaption`: fine-tuning models
- `fal`: pre-trained GenAI models
- `elevenlabs`: TTS
