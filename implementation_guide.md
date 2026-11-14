# ScholarTwin — Master Idea Prompt & Hackathon Implementation Guide

## 1. Copy-Pasteable Master Idea Prompt

```markdown
# Project Concept: ScholarTwin (Multimodal Spatial AI Research & Learning Workspace)

## One-Line Pitch
An interactive AI research & learning workspace that turns lecture slides and scientific papers into clickable concept graphs, live Python simulations, and contradiction maps—and lets you talk to an interactive digital avatar while circling or pointing directly at any part of the graphics to ask questions.

## Target Users
University STEM students, researchers, and hackathon judges who need to go from passive PDFs/lectures to deep understanding, verified claims, and reproducible experiments in minutes.

## Core Modules (Unified 3-Pane Workspace)
1. **LectureGraph (Understand):** Upload a lecture PDF/slide deck -> extracts concepts, prerequisite edges, and slide/timestamp anchors -> renders an interactive knowledge graph + adaptive quiz targeting weak nodes.
2. **Paper2Sim (Reproduce):** Drop an arXiv/bioRxiv PDF or URL -> extracts equations/methodology -> generates clean, sandboxed Python simulation code -> executes it and renders live interactive plots with parameter sliders.
3. **HypothesisGraph / CiteCheck (Verify):** Ingests 20–50+ papers on a topic (via Semantic Scholar / arXiv APIs) -> extracts claims & conditions -> maps supporting vs. contradictory evidence ("Paper A claims X, Paper B refutes X under condition Y") and highlights untested research gaps.
4. **Spatial Multimodal Avatar ("Circle-to-Ask"):** A persistent voice-and-visual digital avatar tutor sitting beside the interactive graphics. Users speak naturally while circling or pointing directly inside any infographic, concept node, equation, or simulation plot—the avatar sees both the cropped visual region and underlying structured data, answers via speech, and highlights/annotates the graphic in real time.

## Technical Differentiation
- **Spatial Capture ("Circle-to-Ask"):** HTML5 Canvas lasso/click overlay -> crops visual region + extracts intersecting graph/plot metadata -> multimodal LLM -> synchronized TTS + UI annotations.
- **Fine-Tuned Small Model:** LoRA/QLoRA fine-tuned 3B–8B model (e.g., Qwen2.5-7B / Llama-3.1-8B) for fast, structured JSON extraction of `{concepts, prerequisite_edges, claims, contradictions}` and clean simulation code generation.
- **Figma-Driven 3-Pane UI:**
  - Left Pane: Digital Avatar + Voice/Mic controls + Source uploader
  - Center Pane: Interactive Graphic Canvas (LectureGraph / Paper2Sim Plot / HypothesisGraph) with Circle-to-Ask overlay
  - Right Pane: Context Inspector (Slide jump, Adaptive Quiz, Simulation Code, Evidence/Contradiction cards)

## Live Demo Flow (3 Minutes)
1. Drop in a real university lecture PDF -> circle a concept node -> ask the avatar a voice question -> avatar explains it + triggers an adaptive quiz question.
2. Switch to a linked arXiv paper -> run live Python simulation -> drag a parameter slider -> circle a curve spike and ask "Why does it spike here?" -> avatar explains and annotates the peak.
3. Query a scientific topic -> show the HypothesisGraph highlighting "Paper A claims X, Paper B refutes X under condition Y" + 1 untested research gap.
```

---

## 2. Competitive Positioning vs. DeepTutor (`deeptutor.info`)

| Dimension | **DeepTutor (`HKUDS/DeepTutor`)** | **ScholarTwin (This Project)** |
|---|---|---|
| **Core Mission** | Lifelong personalized tutor for mastering existing coursework over time. | Active STEM comprehension & research verification workspace. |
| **Document Grounding** | RAG / LightRAG / GraphRAG over uploaded textbooks and notes. | Prerequisite Concept Graph + Cross-Paper Contradiction Graph. |
| **Scientific / Code Depth** | Explains concepts, solves problems, generates static diagrams/videos. | **Paper2Sim:** Compiles paper equations into **sandboxed Python simulations** with live parameter sliders. |
| **Literature Synthesis** | Single-user study & research assistance. | **HypothesisGraph:** Maps supporting vs. contradictory claims & untested gaps across 20–50+ papers. |
| **Tutoring Interface** | Text/chat-first multi-mode workspace + hierarchical memory (L1/L2/L3). | **Voice + Spatial "Circle-to-Ask":** Circle any part of a live graphic/plot and talk to an interactive digital avatar. |

**Pitch Soundbite:**
> *"DeepTutor proved agentic RAG works for studying known material. ScholarTwin is the active research & comprehension layer: we compile paper equations into live simulations, map where 50 papers contradict each other, and let you circle any part of a graphic while talking to an AI avatar to interrogate it."*

---

## 3. Step-by-Step Implementation Guide (24–36h Hackathon)

> **Golden Rule:** Do not build 4 separate apps! Build **one unified 3-pane Knowledge Graph workspace** where every node or graphic can be *Explained* (Avatar + Circle-to-Ask + Quiz), *Simulated* (Paper2Sim), or *Fact-Checked* (HypothesisGraph).

### Phase 1: Lock Architecture, Figma & Demo Data (Hours 0–3)

1. **Pick the Stack:**
   - **Frontend:** Next.js / React + Tailwind CSS + **React Flow** (concept & contradiction graphs) + **Plotly / Recharts** (interactive Paper2Sim plots) + **HTML5 `<canvas>` overlay** (Circle-to-Ask lasso).
   - **Backend:** FastAPI (Python) — keeps PDF parsing (`PyMuPDF`/`fitz`), LLM agents, arXiv/Semantic Scholar APIs, and sandboxed Python execution in one place.
   - **Speech & Avatar:** Web Speech API or Whisper (STT) + ElevenLabs / Cartesia / Edge-TTS (TTS) + **Rive / Lottie / Three.js / Simli** for reactive lip-sync and stateful avatar animation.
2. **Figma Sprint (Designers):**
   - Design **only 3 core views**:
     1. *Upload / Topic Query Bar*
     2. *Main 3-Pane Workspace* (Avatar dock + Interactive Graphic + Inspector panel)
     3. *Simulation & Contradiction Overlay*
   - Export color tokens, typography, and SVG icons immediately so frontend devs can start coding in parallel.
3. **Pre-Cache Demo Data:**
   - Pick **1 killer lecture PDF**, **1 physics/ML arXiv paper** (with clean equations like a damped pendulum, SIR model, or gradient descent), and **1 pre-fetched 30–50 paper topic** (e.g., *solid-state battery electrolytes*) so your live demo never fails on rate limits or slow Wi-Fi.

---

### Phase 2: Core Backend & Fine-Tuning (Hours 3–12)

Split into 3 parallel tracks:

- **Track A — PDF & Graph Pipeline (`LectureGraph` + `HypothesisGraph`):**
  1. Parse PDFs with `PyMuPDF` (`fitz`) or `pdfplumber` (preserve page/slide numbers).
  2. Fetch 20–50 paper abstracts/metadata via **Semantic Scholar API** or **arXiv API**.
  3. Prompt/run your extractor to output strict JSON:
     - `nodes`: `[{id, label, summary, slide_ref}]`
     - `edges`: `[{source, target, type: "prerequisite" | "supports" | "contradicts", condition}]`
  4. Generate 3 adaptive MCQs per node on click.

- **Track B — Simulation Agent (`Paper2Sim`):**
  1. Extract the "Method / Equations" section from the arXiv PDF.
  2. Prompt an LLM to output **self-contained Python** using `numpy` / `scipy` that accepts configurable parameters and returns JSON arrays (`x`, `y`, `labels`) instead of saving static PNGs.
  3. Execute the generated code in a restricted subprocess / Docker sandbox (10s timeout + 1 auto-retry loop if a traceback occurs) and send the data to Plotly on the frontend.

- **Track C — Fine-Tuning Sprint (ML Lead):**
  1. Generate ~300–500 synthetic training examples using a frontier model:
     - *Input:* raw lecture/abstract text -> *Output:* strict `{nodes, edges, contradictions}` JSON.
  2. Run a **QLoRA fine-tune** on `Qwen2.5-7B-Instruct` or `Llama-3.1-8B` (Unsloth / Colab / RunPod — ~30–45 mins).
  3. **Benchmark & Save Screenshot:** Compare Base vs. Fine-Tuned on JSON validity rate, contradiction F1, and latency—put this chart directly in your pitch deck.

---

### Phase 3: Spatial "Circle-to-Ask", Avatar & Frontend (Hours 12–22)

1. **Interactive Graph & Plots (Center Pane):**
   - Color-code edges: **Blue** = prerequisite, **Green** = supports, **Red** = contradicts, **Dashed** = untested gap.
   - Add parameter sliders above the Paper2Sim plot (e.g., learning rate, damping factor, temperature) that re-run the Python simulation live.
2. **"Circle-to-Ask" Spatial Capture Overlay:**
   - Place a toggleable transparent `<canvas>` / SVG layer over the Center Pane (LectureGraph, Paper2Sim plot, or infographic).
   - When the user draws a circle/lasso or clicks:
     - Record bounding box `(x, y, w, h)`.
     - **Visual Crop:** Capture the circled region as a base64 PNG (`html2canvas` or canvas crop).
     - **Structured Hit-Test:** Collect any React Flow `node_id`s, `edge_id`s, or Plotly `(x_min..x_max, y_min..y_max)` data points inside the bounding box.
3. **Speech + Interactive Digital Avatar (Left Pane):**
   - Hold `Space` (or click mic) while circling -> transcribe speech via Web Speech API / Whisper.
   - Send `{ transcript, cropped_image_base64, hit_metadata, active_context }` to `POST /ask-spatial`.
   - Backend queries a multimodal LLM and returns:
     - `spoken_answer`: concise 2–3 sentence explanation -> streamed to TTS -> drives avatar `speaking` animation.
     - `ui_annotations`: e.g., `[{ type: "pulse_node", id: "N4" }, { type: "draw_arrow", x: 320, y: 180, label: "Inflection point" }]` so the graphic highlights in sync with the avatar's voice.

---

### Phase 4: Polish, Stress-Test & Pitch (Hours 22–30+)

1. **Fallback Mode:** Add a "Demo Preset" toggle that loads your pre-tested lecture, paper, and 50-paper contradiction graph in <1 second if conference Wi-Fi drops, while still supporting live uploads.
2. **Pitch Deck (5–6 Slides):**
   - Problem -> Unified Solution -> Live Demo -> Fine-Tuning Benchmark (Base vs. Yours) -> Market/Campus Wedge -> Future Vision (Figma prototype screens).
3. **Rehearse the 3-Minute Demo:** Time every click and voice prompt so the avatar doesn't talk over you!
