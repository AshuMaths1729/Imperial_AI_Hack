# ScholarTwin — Master Idea Prompt & Hackathon Implementation Guide

> **How to read this guide.** Sections 1–3 and Phases 1, 3, 4 and S describe *what* to build and the contracts between the parts. They are deliberately **implementation-agnostic**, so each track owner can choose their own tools. Every concrete library, vendor and API choice is in one place: **Phase 2 → 2.0 Implementation Reference**. Any implementation is acceptable as long as it honours the shared contracts in §3.3.

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
- **Frontier Model + Sponsor Tool Layer:** A frontier multimodal LLM drives every agent and reaches the hackathon sponsor tools (web search, voice, avatar, video, generative models) through MCP or direct APIs, whichever suits each use case.
- **Optional Fine-Tuned Small Model (stretch, toggleable):** A LoRA/QLoRA fine-tuned 3B–8B model for fast, structured JSON extraction of `{concepts, prerequisite_edges, claims, contradictions}`, switchable at runtime against the frontier extractor and benchmarked against it.
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

## 3. Architecture & Shared Contracts (implementation-agnostic)

> **Golden Rule:** Do not build 4 separate apps! Build **one unified 3-pane Knowledge Graph workspace** where every node or graphic can be *Explained* (Avatar + Circle-to-Ask + Quiz), *Simulated* (Paper2Sim), or *Fact-Checked* (HypothesisGraph).

### 3.1 Components and responsibilities

| Component | Responsibility | Requirements |
|---|---|---|
| **Workspace UI** | The 3 panes; renders concept/contradiction graphs (auto-layout, colour-coded edges), simulation plots with sliders, the inspector; hosts the Circle-to-Ask overlay; plays the avatar and on-screen annotations | Can be built against sample data before the backend exists; holds no secrets |
| **API backend** | Ingest jobs, extraction pipelines, simulation generation, `/ask-spatial`, short-lived token minting, Demo Presets | Long-running jobs are asynchronous and report progress |
| **LLM layer** | Every model call, behind task-level interfaces: lecture graph, paper claims, claim comparison, simulation code, quiz, spatial Q&A | Frontier model by default; schema-validated structured output; extraction can be switched to a fine-tuned model (stretch) |
| **Tool layer (broker)** | Every external call — LLM tools, web search, scholarly data, voice, avatar, video, generative models | Caching, offline mode, allow-lists, budgets, logging, untrusted-content handling (§3.2) |
| **Simulation runtime** | Executes generated simulation code | Isolated (no network or filesystem access), time-limited, fast enough for live slider re-runs, works offline |
| **Voice & avatar** | Speech in; an avatar that speaks text produced by *our* backend (the avatar's own conversational AI is not used); audio-only fallback | Speech is synced with annotations at segment level; offline fallback |
| **Cache & Demo Preset** | Stores every external result under a key derived from its inputs; a preset = a frozen cache + media files | The whole demo can run with no network |

### 3.2 Design principles

1. **Frontier model first; fine-tuning is a stretch toggle.** A frontier multimodal model is the default for every LLM task. Only the *extraction* tasks (lecture graph, paper claims, claim comparison) may later be served by a fine-tuned model (Phase S). That model must use the same interface and output schema, be switchable at runtime from config and from the UI, fall back to the frontier model automatically on error or timeout, and record which extractor produced each result (`meta.extractor_used`). Simulation code, quizzes and spatial Q&A always use the frontier model.
2. **Two separate layers of tool access.**
   - **Runtime (the app):** the backend reaches tools with the app's *own* credentials, stored server-side.
   - **Dev time (the team):** MCP connections in the team's AI assistants are used to *produce* designs, media assets and cached demo data. The running app cannot see them.
3. **Runtime access rule — pick per use case:**

   | Access style | Use when | Typical uses |
   |---|---|---|
   | **MCP (model-driven)** | The model should decide whether and what to call, *and* the server accepts a static API key or token (a backend can't complete a browser OAuth sign-in) | Web search and page extraction; generative model runs |
   | **Custom tools (our own functions exposed to the model)** | Our own capabilities that an agent may call | Paper search, paper lookup, simulation run, cache lookup |
   | **Direct API, no LLM in the loop** | Deterministic pipeline steps, latency-critical or streaming media, or the vendor's MCP needs an interactive sign-in | Speech-to-text and TTS streams, avatar sessions, video renders, bulk paper fetch, PDF parsing |
4. **One broker for every external call.**
   - **Caching:** each result is stored under a key derived from the tool, its inputs, the prompt version and the model.
   - **Offline mode:** a flag makes the broker serve only from the cache and fail loudly on a miss.
   - **Allow-lists:** each route may call only the tools it lists.
   - **Budgets:** caps on calls per route, plus timeouts.
   - **Logging:** every call is recorded with its latency and cost.
5. **Untrusted content.** Fetched web or paper content is treated as data, never as instructions. Agents that read it can't reach paid or side-effecting tools.
6. **Secrets stay server-side.** The browser only ever receives short-lived session tokens minted by the backend.
7. **Validated output.** Every model output that feeds the UI is parsed against the shared schema. If parsing fails, retry once with the error message, then fail visibly.
8. **Offline-capable demo (hard requirement).** Every feature in the demo script has a cached fallback.

### 3.3 Shared contracts (freeze in Phase 1)

Define these once as machine-readable schemas shared by backend and frontend; Phase 2.0 recommends the tooling.

**Graph JSON** (shared by LectureGraph and HypothesisGraph):

```jsonc
{
  "graph_id": "g_…",
  "kind": "lecture" | "hypothesis",
  "nodes": [{
    "id": "n1",
    "kind": "concept" | "claim" | "paper",
    "label": "…",
    "summary": "…",
    "source_ref": { "doc_id": "…", "page": 12 }   // slide number for lectures, page for papers
  }],
  "edges": [{
    "id": "e1",
    "source": "n1", "target": "n2",
    "type": "prerequisite" | "supports" | "contradicts" | "gap",
    "condition": "at T > 60 °C",                  // optional
    "evidence": [{ "paper_id": "…", "quote": "…" }],
    "confidence": 0.0–1.0
  }],
  "meta": { "extractor_used": "frontier" | "finetuned", "created_at": "…" }
}
```

Edge rendering: **blue** = prerequisite, **green** = supports, **red** = contradicts, **dashed grey** = gap (untested). Prerequisite edges must have no cycles.

**Simulation contract** (Paper2Sim): the generated code is self-contained Python that uses only numerical/scientific libraries and defines exactly:

```python
PARAMS = {"damping": {"min": 0.0, "max": 2.0, "default": 0.3, "step": 0.05, "unit": "1/s", "label": "Damping γ"}}

def simulate(**params) -> dict:
    return {"title": "…", "x_label": "t (s)", "y_label": "θ (rad)",
            "series": [{"name": "θ(t)", "x": [...], "y": [...]}]}
```

Output rules:
- plain JSON-serialisable lists only;
- finite numbers only (no NaN or Inf);
- at most ~5,000 points per series.

The runtime validates the output shape before plotting.

**`POST /ask-spatial`**

```jsonc
// request
{ "transcript": "why does it spike here?",
  "cropped_image_base64": "…",
  "hit_metadata": { "node_ids": [], "edge_ids": [], "plot_range": { "x": [2.1, 3.4], "y": [0.2, 0.9] }, "bbox": [x, y, w, h] },
  "active_context": { "view": "sim" | "lecture" | "hypothesis", "graph_id": "…", "paper_id": "…", "params": { } } }
// response
{ "spoken_answer": "full text (for captions / fallback TTS)",
  "segments": [ { "text": "This peak is resonance…", "ui_annotations": [ { "type": "pulse_node", "id": "n4" } ] },
                { "text": "…because damping is low.", "ui_annotations": [ { "type": "draw_arrow", "x": 320, "y": 180, "label": "Inflection point" } ] } ],
  "follow_up": { "type": "quiz", "node_id": "n4" } }
```

The frontend speaks one segment at a time and fires that segment's annotations when it starts. This keeps speech and graphics in sync with any voice or avatar implementation, and needs no word-level timing. Annotation types: `pulse_node`, `highlight_edge`, `draw_arrow`, `circle_region`, `show_card`.

**Backend endpoints**

| Endpoint | Purpose |
|---|---|
| `POST /ingest/lecture` (file) → `{job_id}` | Parse + extract LectureGraph |
| `POST /ingest/paper` (file \| arXiv id \| URL) → `{job_id}` | Parse paper, extract method/equations |
| `POST /topics` (`{query}`) → `{job_id}` | Build HypothesisGraph for a topic |
| `GET /jobs/{id}/events` (server-sent events) | Progress events `{stage, pct, message, result_id?}` |
| `GET /graphs/{id}` | Graph JSON |
| `GET /quiz/{graph_id}/{node_id}` | Pre-generated MCQs (+ `POST` answer → mastery update) |
| `POST /sim/{paper_id}/generate` | `{PARAMS, code, explanation, assumptions}` |
| `POST /sim/run` | Server-side fallback execution |
| `POST /ask-spatial` | See above |
| `POST /avatar/session` | Mint a short-lived avatar session token |
| `POST /stt/token` | Mint a short-lived speech-to-text token if STT streams from the browser |
| `GET /presets`, `POST /presets/{name}/load` | Demo Preset mode |

---

## 4. Step-by-Step Implementation Guide (24–36h Hackathon)

### Phase 1: Lock Architecture, Figma & Demo Data (Hours 0–3)

1. **Lock the contracts (§3.3):** agree on the schemas and endpoint list *before* splitting up. First commit the schemas plus hand-written sample-data files (fixtures): one lecture graph, one hypothesis graph, one simulation and one `/ask-spatial` response. Every track builds and tests against them.
2. **Confirm the stack:** each track owner reviews the Phase 2.0 Implementation Reference for their area and either adopts it or names an equivalent. The only hard constraint is the §3.3 contracts. Record the final choices in the repo README.
3. **Credentials & access:** get credentials for every external service in the chosen stack and store them server-side only. Apply first for any key that needs approval or is rate-limited, since approval can take time. Confirm the team's dev-time MCP connections are signed in.
4. **Verify before building** (one person, about 30 minutes): smoke-test each critical-path integration:
   - the LLM can reach the chosen tools;
   - the avatar can speak arbitrary text sent from our backend;
   - speech-to-text latency on the venue Wi-Fi;
   - the simulation runtime's cold-start time.

   Phase 2.0 lists the specific checks for the recommended stack.
5. **Figma sprint (designers):** design **only 3 core views**:
   1. Upload / Topic Query Bar
   2. Main 3-Pane Workspace (Avatar dock + Interactive Graphic + Inspector)
   3. Simulation & Contradiction Overlay

   Export colour tokens, typography and SVG icons immediately, in a format the frontend can consume, so frontend devs can start in parallel.
6. **Pick and pre-cache demo data:**
   - **1 killer lecture PDF**;
   - **1 physics/ML arXiv paper** with clean ODE-style equations (damped pendulum, SIR model, gradient descent) and its equation source available in machine-readable form (e.g., LaTeX);
   - **1 pre-fetched 30–50 paper topic** (e.g., *solid-state battery electrolytes*).

   That topic is mostly journal literature, so the paper source must cover journals, not just preprint servers.

---

### Phase 2: Core Backend & Integrations (Hours 3–12)

Phase 2 is where implementation choices are made. **2.0 is the recommended reference for the whole build**, including how Phases 3 and S are implemented; the tracks below follow it. A track owner can swap any choice for an equivalent as long as the §3.3 contracts still hold.

#### 2.0 Implementation Reference

**Recommended stack**

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js (React) + Tailwind | A plain Vite SPA is also fine — there is no SSR requirement. Load Plotly and Pyodide client-only (`dynamic(..., { ssr: false })`). |
| Graphs | React Flow (`@xyflow/react` v12) + `elkjs` (or `dagre`) for auto-layout | The extractor returns no coordinates; the layout engine computes them. |
| Sim plots | **Plotly** (`react-plotly.js`, partial bundle) | Chosen over Recharts: Plotly's built-in lasso/box select (`plotly_selected`) gives Circle-to-Ask its data-range hit-test for free. |
| Sim execution | **Pyodide in a Web Worker** (primary) + Docker sandbox on the backend (fallback) | See Track B. |
| Visual crop | `html-to-image` for the React Flow canvas, `Plotly.toImage` for plots | Not `html2canvas` — it mis-renders React Flow SVG edges and cannot capture WebGL traces. |
| Backend | FastAPI (Python 3.11+), Pydantic v2 models, `httpx`, background jobs + server-sent events for progress | |
| PDF | PyMuPDF (`fitz`) for page rendering, text and page numbers; **arXiv LaTeX source** (`arxiv.org/e-print/<id>`) for equations | Also send the PDF itself to Claude as a `document` block — it reads both page text and page images, so slide diagrams are understood. |
| LLM | **Claude API, frontier model** (`claude-opus-5-5`) via the official `anthropic` Python SDK | Fine-tuned model = Phase S only. |
| Scholarly data | Semantic Scholar Graph API (with API key) + OpenAlex (no key) + arXiv API | Exposed as our own Python tools. |
| Voice in (STT) | ElevenLabs speech-to-text (sponsor) → Web Speech API fallback → typed input fallback | Web Speech works only in Chrome/Edge and needs network. |
| Voice out (TTS) + avatar | **Anam** avatar (sponsor) speaking our text via `talk()`; ElevenLabs TTS for audio-only mode and cached demo audio | |
| Pre-rendered video | Synthesia (sponsor) | Pre-rendered clips only, never in the live loop (renders take minutes). |
| Design | Figma (sponsor) | Design time only. |

**LLM layer**

All LLM calls go through one backend module, `llm/`, with one interface for the extraction tasks:

```python
class Extractor(Protocol):
    async def lecture_graph(self, doc: SourceDoc) -> Graph: ...
    async def paper_claims(self, paper: Paper) -> list[Claim]: ...
    async def compare_claims(self, cluster: list[Claim]) -> list[Edge]: ...
```

- **`FrontierExtractor` (default, built in Phase 2):** Claude API, model `claude-opus-5-5`.
- **`FineTunedExtractor` (Phase S):** calls an OpenAI-compatible endpoint serving the LoRA model and returns the *same* Pydantic types.
- Selection: env var `EXTRACTOR_BACKEND=frontier|finetuned`, plus a per-request override (`?extractor=finetuned`) so the UI can flip it live. On error or timeout, fall back to frontier and set `meta.extractor_used`.

Claude API rules to follow (they cause 400s or silent failures if missed):
- Get JSON via **structured outputs** (`client.messages.parse()` with the Pydantic model, or `output_config.format`). Don't rely on forced `tool_choice` (`any`/`tool` is rejected on `claude-opus-5-5`) or on assistant prefill (also rejected).
- **Effort:** thinking is adaptive and can't be disabled on Opus 5.5, so control speed and cost with `output_config.effort`. Use `low` for `/ask-spatial` and quizzes, and `medium`/`high` for extraction and code generation. The default is `medium`, so set it explicitly per route.
- **Streaming:** stream any long request (`client.messages.stream(...).get_final_message()`) to avoid HTTP timeouts.
- **Stop reasons:** check `stop_reason` (`refusal`, `max_tokens`) before reading the content. Turn on the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).
- **Caching:** put stable content first (system prompt, schema, tool list) and use prompt caching. The same lecture or paper gets queried many times during a demo.
- **Model config:** keep the model ID in config per route (`MODEL_EXTRACT`, `MODEL_CODEGEN`, `MODEL_ASK`), all defaulting to `claude-opus-5-5`, so cost and latency can be tuned per route without code changes.

**Tool access per sponsor and service** (applies the access rule in §3.2):

| Tool | What ScholarTwin uses it for | Runtime access | Dev-time access | Cached fallback (Demo Preset) |
|---|---|---|---|---|
| **Claude API** | All extraction, code generation, quizzes, `/ask-spatial` (vision) | Official `anthropic` SDK | — | Cached responses keyed by input hash |
| **Tavily** | HypothesisGraph research agent: find full text and condition details missing from abstracts, plus non-arXiv sources; Paper2Sim URL ingestion (extract page content) | **MCP connector** → `https://mcp.tavily.com/mcp/`, API key as bearer token; only the search/extract tools allow-listed | Claude Code MCP (optional) | Cached search/extract results |
| **fal** | Optional generated visuals for the inspector (e.g., an illustration for a concept node); optional STT model; candidate host for the stretch fine-tune | **MCP connector** for model-chosen calls, using the API-key bearer endpoint (verify — the newer `mcp-relay` endpoint is OAuth-only); or the `fal-client` SDK for a fixed model in a hot path. Behind a feature flag, since calls cost money | Claude Code MCP + fal's model-picker agent to choose models | Pre-generated images in the preset |
| **ElevenLabs** | STT for the mic; TTS for audio-only mode; a designed tutor voice | **Direct API** (`xi-api-key`, server-side only; mint short-lived tokens for any browser-side streaming). The hosted MCP (`api.elevenlabs.io/v1/mcp`) is OAuth-only, so it can't run unattended in a backend | Claude Code MCP: design the voice, pre-generate demo audio | Pre-generated MP3s for every scripted demo answer |
| **Anam** | The live avatar in the left pane | **Direct API:** the backend mints a session token with the API key and a persona config that sets `llmId: "CUSTOMER_CLIENT_V1"`, which turns off Anam's own LLM. In the browser, **`@anam-ai/js-sdk`** speaks each segment of our answer via `talk()` / talk stream | — | Static avatar image + cached ElevenLabs audio |
| **Synthesia** | Pre-rendered 30–60 s explainer clips for key demo concepts; intro clip for the pitch | Not in the live path. Phase S2: Synthesia REST API (API key, plan-dependent) | Claude Code MCP: create the demo clips | MP4s in the preset |
| **Figma** | The 3 core views, design tokens, icons | Not used at runtime | Figma MCP in Claude Code (design → code, tokens → Tailwind) | — |
| **Adaption** | Phase S1 only: build and evaluate the training dataset, then hand it to Together for fine-tuning | REST API / Python SDK | — | — |
| **Semantic Scholar / OpenAlex / arXiv** | Paper search, metadata, abstracts, TLDRs, LaTeX source | **Custom tools** + deterministic fetch code (`httpx`) | — | Pre-fetched topic corpus in the preset |
| **Claude server tools** (`web_search` / `web_fetch`) | Backup if the Tavily quota runs out | Server tools, off by default | — | — |

**Broker implementation** (`tools/broker.py`):
- **Cache key:** `sha256(tool + args + prompt_version + model)`; entries are written to `cache/`.
- **Offline mode:** `OFFLINE=1`.
- **Allow-lists:** set per route in the Tool Runner, and through the MCP toolset config so only the listed MCP tools are enabled.
- **Budgets:** `max_uses` on server tools, iteration caps on Tool Runner loops, and `httpx` timeouts.
- **Logging:** every call is logged with its latency and cost.
- **Side-effecting or paid tools** (fal generation, Synthesia renders, ElevenLabs agent management) are never exposed to an agent that reads web content.

**MCP connector mechanics** (Claude API, beta `mcp-client-2025-11-20`):
- Pass `mcp_servers=[{type: "url", name, url, authorization_token}]` **and** a matching `tools=[{type: "mcp_toolset", mcp_server_name: name, ...}]`. A server list on its own is rejected.
- Only remote (HTTP) MCP servers work through the connector. For a local MCP server, use the SDK's MCP helpers (`anthropic[mcp]`) with the Tool Runner.
- Check the exact allow-list fields against the current docs when implementing.

**Contract tooling:** write the §3.3 schemas as Pydantic v2 models in `schemas/`, and generate the frontend's TypeScript types from FastAPI's OpenAPI output with `openapi-typescript`. The simulation runner wrapper:
- converts numpy arrays with `.tolist()`;
- rejects NaN/Inf;
- caps series length;
- validates against the schema.

**Credentials** (`.env`, server-side only):
- `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `ELEVENLABS_API_KEY`, `ANAM_API_KEY`, `FAL_KEY`;
- `SYNTHESIA_API_KEY`, only if the plan includes API access;
- `S2_API_KEY` — apply immediately: approval can take time, and the shared unauthenticated pool is throttled;
- a contact email for the OpenAlex polite pool.

Dev-time MCPs to have signed in to Claude Code: Figma, Synthesia, ElevenLabs, fal, Tavily.

**Integration smoke tests** (Phase 1, step 4):
- The Claude MCP connector reaches the Tavily MCP and returns a search result, using the API key as a bearer token.
- fal's MCP endpoint accepts an API key; if not, use `fal-client` directly.
- Anam: mint a session token with `CUSTOMER_CLIENT_V1` and call `talk("hello")` from the browser. Check which voices are available and whether the chosen avatar model supports multi-utterance (segment IDs).
- ElevenLabs STT latency from the venue Wi-Fi.
- Pyodide + scipy cold-load time in the browser.

**Phase 3 implementation notes:**
- **Graph hit-test:** convert the bbox to flow coordinates (React Flow viewport transform) and intersect it with node and edge bounds.
- **Crop:** `html-to-image` on the React Flow viewport, `Plotly.toImage` for plots, then crop and downscale.
- **Plot hit-test:** Plotly lasso/box select (`plotly_selected`), or convert pixel to data coordinates from the axis ranges.
- **Sliders:** re-run the simulation in the Pyodide worker, debounced by ~100 ms.
- **STT:** ElevenLabs speech-to-text → Web Speech API fallback → text box.
- **Avatar:** each segment becomes one Anam `talk()` utterance (or talk-stream chunk). In audio-only mode, each segment becomes one ElevenLabs TTS clip.
- **`/ask-spatial`:** one Claude call with vision, hit metadata and context, structured output and `effort: low`; downscale the image to ≤ 1024 px.
- **Explainer clips:** Synthesia MP4s served from the preset.

**Phase S implementation options:**
- **S1 data:** Adaption (Adaptive Data / Invent) to build and evaluate the dataset, or examples generated with a frontier model (subject to that provider's terms).
- **S1 base model:** a Qwen3-family 4B–8B instruct model (4B keeps serving fast).
- **S1 training:** Adaption → Together LoRA fine-tuning, or Unsloth on a rented GPU.
- **S1 serving:** an OpenAI-compatible GPU endpoint (Together or vLLM; fal is another option to check). Wire it in as `FineTunedExtractor`.
- **S2:** Synthesia REST API.
- **S3:** fal, with the model chosen via fal's model-picker agent.

#### Phase 2 tracks

Split into three backend tracks plus the frontend shell, all running in parallel. **Track C is now platform & integrations**, since fine-tuning has moved to Phase S.

- **Track A — PDF & Graph Pipeline (`LectureGraph` + `HypothesisGraph`):**
  1. **Lecture ingest:**
     - PyMuPDF renders each page to PNG (for slide-jump thumbnails) and extracts text with page numbers.
     - Send the PDF to Claude as a `document` block and get a `Graph` back via structured outputs in one pass. Claude reads text *and* page images, so diagram-only slides work.
     - Post-process: merge duplicate concepts, drop prerequisite back-edges and validate every `source_ref`.
  2. **Topic ingest (HypothesisGraph):** fetch deterministically from Semantic Scholar via `/paper/search` + `/paper/batch` (fields: title, abstract, tldr, year, venue, externalIds). OpenAlex is the backup and also fills in missing abstracts. Some papers have no abstract: keep the TLDR, or drop the paper.
  3. **Claim extraction:** one structured-output call per paper → `Claim{entity, property, direction, value, condition, paper_id, quote}`. Run them in parallel (asyncio, bounded concurrency). For the pre-cached preset, use the Message Batches API (half price, asynchronous).
  4. **Contradiction mapping without comparing every pair of papers:**
     - Group claims by (entity, property), using embeddings or the LLM's normalised keys.
     - Make one `compare_claims` call per group → `supports` / `contradicts` edges with `condition` and evidence quotes.
     - For each group, ask which combinations of conditions no paper tests; these become `gap` edges.
  5. **Research agent for live topic queries:** a Tool Runner loop with the custom tools `search_papers` and `get_paper`, plus the **Tavily MCP toolset** (search/extract only) to fill in the conditions that abstracts leave out. Cap the iterations and treat all fetched content as data.
  6. **Quiz:**
     - After a graph is built, pre-generate 3 MCQs per node in the background (`effort: low`) and cache them; clicking a node just reads the cache.
     - Track mastery per node. "Adaptive" means targeting the weakest node and its unmastered prerequisites.
  7. Report progress for every stage on `/jobs/{id}/events`.

- **Track B — Simulation Agent (`Paper2Sim`):**
  1. **Equation source:** for arXiv papers, download the LaTeX source (`arxiv.org/e-print/<id>`) and extract the method section and equations. Otherwise, send the PDF to Claude, whose page images help with equations. Don't rely on PyMuPDF text for maths.
  2. **Code generation:** a structured-output call returns `{PARAMS, code, explanation, assumptions}`. The code follows the simulation contract (numpy/scipy only, e.g., `scipy.integrate.solve_ivp`).
  3. **Execution — primary: Pyodide in a Web Worker** (Pyodide includes numpy and scipy):
     - The browser is the sandbox, slider re-runs are instant with no server round-trip, and it works offline.
     - Preload Pyodide and scipy when the app opens; the first download is large.
     - Harden it: reject code that imports anything outside numpy/scipy/math (a simple AST check, which also blocks `js` and `pyodide.http`), set a strict CSP `connect-src` for the worker, and `worker.terminate()` it after a 10 s timeout.
  4. **Execution — fallback: a Docker sandbox on the backend**, exposed as the `run_simulation` custom tool:
     - `--network none`, memory and CPU limits, read-only filesystem, non-root user;
     - a container kept warm, and a 10 s timeout.

     A bare `subprocess` is **not** a sandbox, and Python's `resource` limits don't exist on Windows.
  5. **Validation + retry:** validate the output against the contract (schema, NaN/Inf, length). On a traceback *or* a validation failure, send the error back to the model and retry once. Hand-check the demo paper's output: code that runs can still be physically wrong.
  6. Frontend sliders are generated from `PARAMS`, and each move triggers a debounced (~100 ms) re-run in the worker.

- **Track C — Platform & Integrations (the former ML lead):**
  1. **`llm/` module:** the Claude client wrapper, per-route model and effort config, structured-output helpers, refusal/`max_tokens` handling, prompt caching, and the `Extractor` interface with `FrontierExtractor`.
  2. **`tools/broker.py`:** as described above, plus the MCP connector config for Tavily (and fal behind a flag).
  3. **Job runner** + progress events (server-sent events).
  4. **Voice and avatar backend:**
     - `POST /avatar/session` (Anam token) and `POST /stt/token`;
     - an ElevenLabs TTS helper that returns audio per segment, also used to pre-generate demo audio.
  5. **A stub `POST /ask-spatial` that returns canned `segments`** by hour ~6, so Phase 3 frontend work isn't blocked. Replace it with the real implementation in Phase 3.
  6. **Demo Preset loader** (`/presets`), fed by the broker cache.

- **Track D — Frontend shell (in parallel, against the fixtures):**
  - the 3-pane layout, using the Figma tokens;
  - React Flow + elkjs rendering the fixture graphs with coloured edges;
  - the Pyodide worker running the fixture simulation, with generated sliders;
  - the inspector cards;
  - the job-progress UI, fed by server-sent events.

  Switch from fixtures to live endpoints as each track lands.

---

### Phase 3: Spatial "Circle-to-Ask", Avatar & Frontend (Hours 12–22)

1. **Interactive Graph & Plots (Center Pane):**
   - Render graphs with automatic layout, and colour-code edges: **Blue** = prerequisite, **Green** = supports, **Red** = contradicts, **Dashed** = gap (untested).
   - Generate parameter sliders from the simulation's `PARAMS` and place them above the Paper2Sim plot (e.g., learning rate, damping factor, temperature). Moving a slider re-runs the simulation live, fast enough to feel interactive while dragging.
2. **"Circle-to-Ask" Spatial Capture Overlay:**
   - Place a toggleable transparent drawing layer over the Center Pane (LectureGraph, Paper2Sim plot, or infographic).
   - When the user draws a circle/lasso or clicks:
     - Record the bounding box `(x, y, w, h)`.
     - **Visual crop:** capture the circled region as a base64 PNG, downscaled to ≤ 1024 px. The capture must include graph edges and plot traces, not just HTML elements.
     - **Structured hit-test:** collect the graph `node_id`s / `edge_id`s inside the region. For plots, collect the data range `(x_min..x_max, y_min..y_max)` and the selected data points.
3. **Speech + Interactive Digital Avatar (Left Pane):**
   - **Speech in:** hold `Space` (or click the mic) while circling to start speech-to-text. A fallback recogniser is available, and a typed-input box is always there as the last resort.
   - **Request:** send `{transcript, cropped_image_base64, hit_metadata, active_context}` to `POST /ask-spatial` (contract in §3.3).
   - **Answer:** the backend sends the crop, hit metadata and relevant graph/simulation context to the multimodal model, and returns `spoken_answer` + `segments`.
   - **Playback:** the frontend plays the segments in order through the avatar (or the audio-only fallback), firing each segment's `ui_annotations` as that segment starts. Captions show `spoken_answer`.
   - **Latency target:** under 3 s from mic release to the avatar starting to speak. If it's slower, stream the response and start speaking at the first complete segment.
4. **Pre-rendered explainer clips:** when a node has a pre-rendered clip in the preset, show it in the inspector.

> Recommended libraries and services for each item: Phase 2.0 → *Phase 3 implementation notes*.

---

### Phase 4: Polish, Stress-Test & Pitch (Hours 22–30+)

1. **Fallback mode:** add a "Demo Preset" toggle that loads the pre-tested lecture, paper and 50-paper contradiction graph from the cache in under 1 s if the Wi-Fi drops, while still supporting live uploads. Rehearse once in offline mode with Wi-Fi off:
   - every scripted question needs a cached answer and audio;
   - the avatar falls back to a static image plus cached audio.
2. **Pitch Deck (5–6 Slides):**
   1. Problem
   2. Unified Solution
   3. Live Demo
   4. Architecture & sponsor tool integration
   5. Market/Campus Wedge
   6. Future Vision (Figma prototype screens)

   If Phase S1 shipped, add the Fine-Tuned vs. Frontier benchmark slide.
3. **Rehearse the 3-Minute Demo:** time every click and voice prompt so the avatar doesn't talk over you!

---

### Phase S: Stretch Goals (only after the core demo works end to end)

Start a stretch item only when the full demo path from Phase 3 runs end to end (target: hours ~20–22) and someone is free. Each item sits behind a flag and is off by default.

- **S1 — Fine-tuned extractor (toggle):** a small fine-tuned model that performs the extraction tasks (`{nodes, edges, contradictions}` in the frozen schema) faster or more cheaply than the frontier model. It is switchable at runtime as described in §3.2, principle 1.
  1. **Data:** 300–500 examples of *raw lecture/abstract text → strict JSON matching the frozen schema*. If you generate the examples with a model, check that provider's terms on using its outputs to train other models.
  2. **Train:** LoRA/QLoRA on a small (3B–8B) open instruct model.
  3. **Serve:** a hosted endpoint fast enough for live use. A 7B model running locally on a laptop is too slow for the demo.
  4. **Wire up:** plug it in behind the existing extractor interface and toggle. The UI gets an "Extractor: Frontier | Fine-tuned" switch, with automatic fallback to frontier.
  5. **Benchmark honestly:** compare fine-tuned vs. frontier (and optionally the untuned base model) on a **hand-checked** held-out set of 30–50 examples. Measure:
     - field-level precision/recall for nodes and edges;
     - contradiction F1, matching on claim pair + direction;
     - latency;
     - cost per document.

     Don't headline "JSON validity": schema-constrained output makes that 100% for every model.
- **S2 — On-demand explainer clip per node:** queue a video render for any node, show a "rendering…" state, then play the clip.
- **S3 — Generated concept illustrations** in the inspector.

> Implementation options (data platform, base model, training and serving services, video and image generation): Phase 2.0 → *Phase S implementation options*.

---

## 5. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Venue Wi-Fi / API outage during demo | Demo fails | Demo Preset served from the cache; offline-mode rehearsal; cached audio + static avatar |
| Scholarly API throttling | Topic ingest stalls | Apply for keys early; batch requests; a second data source as backup; demo topic pre-fetched |
| Abstracts lack conditions | Weak "under condition Y" edges | Retrieve full text for key papers; hand-verify the demo topic |
| Generated sim code runs but is wrong | Embarrassing plot | Hand-validate the demo paper; show the model's `assumptions` in the inspector |
| `/ask-spatial` latency > 3 s | Avatar feels laggy | Lower reasoning effort for this route, downscale images, cache the stable prompt context, start speaking at the first segment |
| Avatar service or connection issues | No avatar | Audio-only mode + static avatar image |
| Prompt injection via fetched web content | Agent misuse | Tool allow-lists; treat fetched content as data; no paid or side-effecting tools in agents that read the web |
| API keys leaking to the browser | Key abuse | Keys server-side only; short-lived tokens for browser-side sessions |
| Schema drift between tracks | Integration pain at hour 20 | Frozen shared schemas + generated client types from Phase 1 |
| Scope creep into stretch goals | Core demo unfinished | Phase S starts only once the end-to-end demo works |
