# ScholarTwin — Imperial AI Hackathon

An interactive multimodal AI research & learning workspace that unifies **LectureGraph**, **Paper2Sim**, and **HypothesisGraph** into a single 3-pane canvas with **Circle-to-Ask** spatial tutoring and a reactive digital avatar.

## Core Modules (Unified 3-Pane Workspace)

- **LectureGraph (Understand):** Concept & prerequisite knowledge graph with slide/timestamp anchors and adaptive MCQs.
- **Paper2Sim (Reproduce):** Extracts paper equations into sandboxed Python simulations with live parameter sliders and interactive plots.
- **HypothesisGraph (Verify):** Maps supporting vs. contradictory claims across papers (`supports`, `contradicts`, `gap`) and surfaces untested research gaps.
- **Circle-to-Ask Avatar:** Toggle the lasso overlay on any graph or plot, circle a region, and ask via voice or text for synchronized explanations and UI annotations.

## Quick Start

Run both the FastAPI backend (`http://127.0.0.1:8000`) and Next.js frontend (`http://localhost:3000`):

```bash
./start.sh
```

### Manual Setup (if needed)

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

## Project Structure

- `backend/` — FastAPI server, Pydantic schemas, live ODE simulator, and pre-cached demo datasets (`demo_data/`).
- `frontend/` — Next.js + Tailwind CSS + React Flow 3-pane workspace (`AvatarDock`, `GraphCanvas`, `PaperSimCanvas`, `LassoOverlay`, `InspectorPane`).
- `start.sh` — Launches backend and frontend together with clean `Ctrl+C` shutdown.
- `implementation_guide.md` — Full hackathon architecture and phase roadmap.

## Sponsor / Tool Stack Notes

- `synthesia` / `anam`: avatar and video/graphic creation
- `tavily`: web crawl and search
- `figma`: UI design
- `adaption`: fine-tuning models
- `fal`: pre-trained GenAI models
- `elevenlabs`: TTS
