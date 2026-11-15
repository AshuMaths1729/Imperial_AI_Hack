# Athena — Imperial AI Hackathon

An interactive multimodal AI research & learning workspace with a 3-mode entry hub (**LectureUnderstanding**, **PaperSim**, and **HypothesisGraph**), **Circle-to-Ask** spatial tutoring, and a reactive **LiveKit + Synthesia** digital avatar.

## Core Modules & UI Flow

The landing hub (`HomeHub`) routes into three dedicated workflows:

- **LectureUnderstanding (Understand):** Opens a **Library** of saved lecture conversations and a **New Conversation** floating toast for PDF/URL ingestion, leading into a **2-pane** avatar + interactive concept graph workspace (`AvatarDock`, `GraphCanvas`, `LassoOverlay`) with **Circle-to-Ask** spatial tutoring.
- **PaperSim (Reproduce):** Opens a **Library** of saved paper simulations and a **New Conversation** PDF/URL toast, leading into a **tabbed interactive visualisation** workspace (`PaperSimTabsView`) with live parameter-sweep plots, concept & parameter graphs, series breakdowns, and extracted Python equations.
- **HypothesisGraph (Verify):** A dedicated **Topic-to-Graph** generator (`HypothesisChatView`) with text + mic input and saved topic history. Queries grounded papers across **Semantic Scholar → OpenAlex (with 429/5xx retry) → arXiv → Europe PMC** and renders a full-viewport graph with per-node citations, grayed-out unlinked nodes, click-to-zoom neighbourhoods, click-to-inspect edge explanation cards (`supports`, `contradicts`, `gap`), and a clickable **Graph Citations** side pane linking directly to arXiv, OpenAlex, Semantic Scholar, Europe PMC, and DOI sources.
- **Circle-to-Ask & Live Avatar Tutor:** Toggle the lasso overlay on the lecture canvas to circle a region and ask via voice or text, or start a Live Lesson (`/lecture/lesson`) for a live Synthesia/LiveKit avatar call.

## Themes & Accessibility

- **Light (default), Dark & High-Contrast Themes:** Switchable from any header via `ThemeToggle` (`ThemeProvider`), built with translucent glass materials, optical typography, instant pointer-down feedback, and `@media` support for `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast`.
- **Color-Blind-Safe Visuals:** Uses an Okabe-Ito-inspired palette (Cobalt Blue, Deep Teal, Vermilion-Orange, Plum/Magenta) paired with redundant line dash patterns in `GraphCanvas` and `PaperSimCanvas` and semantic icons across badges and quiz feedback.

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

### Live lesson tutor

The live Synthesia/LiveKit tutor (Live Lessons at `/lecture/lesson`) needs LiveKit keys in `.env` and its agent worker running
next to `./start.sh`: `cd agent && uv run agent.py dev`.
Full setup, per-developer agent names and troubleshooting: [`agent/README.md`](agent/README.md).

### Shared types

The backend's Pydantic models are the contract. After changing routes or `backend/app/schemas/`:

```bash
cd backend && uv run python scripts/export_openapi.py   # writes schemas/openapi.json
cd frontend && npm run gen:types                         # writes src/api/types.gen.ts
```

## Project Structure

- `backend/app/` — FastAPI app: `main.py` (`create_app()`, auto-discovers `modules/*`), `settings.py`, `deps.py`, `schemas/` (shared contracts), `core/` (cache, jobs, errors), `llm/`, `tools/` (broker, registry, and `scholarly/` multi-source search across S2, OpenAlex, arXiv, and Europe PMC), `modules/` (one package per feature; `legacy` holds the Phase-1 prototype routes, `fixtures_api` serves the shared fixtures).
- `fixtures/` — shared JSON samples (lecture/hypothesis graphs, simulation, ask-spatial answers, job events) validated against the schemas by the tests.
- `schemas/openapi.json` — generated OpenAPI document (source of the frontend types).
- `frontend/` — Next.js 16 + Tailwind CSS + React Flow workspace (`HomeHub`, `LibraryView`, `UploadModal`, `AvatarDock`, `GraphCanvas`, `PaperSimTabsView`, `PaperSimCanvas`, `HypothesisChatView`, `LassoOverlay`, `ThemeProvider`, `src/api/adapters.ts`, and `src/api/citations.ts`).
- `DESIGN.md` / `design.JPG` — System & UI architecture documentation and diagram.
- `start.sh` / `start.ps1` — Launch backend and frontend together with clean `Ctrl+C` shutdown.
- `implementation_guide.md` — Full hackathon architecture and phase roadmap.

## Sponsor / Tool Stack Notes

- `synthesia`: avatar and video/graphic creation (pre-rendered clips)
- `tavily`: web crawl and search
- `figma`: UI design
- `adaption`: fine-tuning models
- `fal`: pre-trained GenAI models
- `elevenlabs`: TTS
