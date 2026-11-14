"""LEGACY Phase-1 prototype routes, kept so the existing frontend keeps working.

REMOVE THIS MODULE once Tracks B/C/D replace these routes (see the plan's migration map):
  /api/demo/{mode}, /api/simulate   -> Track B (`/api/sim/...`) + Track A graphs
  /api/ingest/pdf, /api/ingest/url  -> Track A/B ingest jobs
  /api/ask-spatial (old shape)      -> Track C5 (new `AskSpatialRequest` on the same path;
                                       a new route mounted before this module shadows it)
"""

from __future__ import annotations

import json
import math
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import pymupdf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.deps import get_settings
from app.modules.legacy.legacy_schemas import (
    GraphEdge,
    GraphNode,
    QuizQuestion,
    SimulationSeries,
    SpatialAskRequest,
    SpatialAskResponse,
    UIAnnotation,
    UrlIngestRequest,
    WorkspaceDataset,
)
from app.schemas.health import HealthResponse
from app.settings import Settings

router = APIRouter(tags=["legacy"])

DEMO_DIR = Path(__file__).parent / "demo_data"


def run_heavy_ball_sim(
    gamma: float = 0.35, eta: float = 2.4, theta0: float = 1.8, steps: int = 180
):
    dt = 0.08
    xs = [round(i * dt, 2) for i in range(steps)]
    theta = [0.0] * steps
    vel = [0.0] * steps
    energy = [0.0] * steps
    envelope = [0.0] * steps

    theta[0] = theta0
    energy[0] = round(0.5 * (theta0**2), 4)
    envelope[0] = round(theta0, 4)

    for i in range(1, steps):
        t = i * dt
        grad = theta[i - 1] + 0.15 * math.sin(3.0 * theta[i - 1])
        acc = -gamma * vel[i - 1] - eta * grad
        vel[i] = vel[i - 1] + dt * acc
        theta[i] = round(theta[i - 1] + dt * vel[i], 4)
        energy[i] = round(0.5 * (theta[i] ** 2) + 0.5 * (vel[i] ** 2) / max(eta, 0.1), 4)
        envelope[i] = round(theta0 * math.exp(-0.5 * gamma * t), 4)

    return xs, [
        SimulationSeries(name="Parameter Trajectory θ(t)", color="#38bdf8", y=theta),
        SimulationSeries(name="Lyapunov Loss Energy E(t)", color="#f43f5e", y=energy),
        SimulationSeries(name="Theoretical Damping Envelope", color="#a855f7", y=envelope),
    ]


@router.get("/health", response_model=HealthResponse)
def health(settings: Settings = Depends(get_settings)):
    return HealthResponse(
        status="ok",
        cache_mode=settings.cache_mode,
        preset=settings.preset,
        service="ScholarTwin Phase 1",
    )


@router.get("/demo/{mode}", response_model=WorkspaceDataset)
def get_demo_dataset(mode: str):
    file_map = {
        "lecture": DEMO_DIR / "lecture_demo.json",
        "paper2sim": DEMO_DIR / "paper2sim_demo.json",
        "hypothesis": DEMO_DIR / "hypothesis_demo.json",
    }
    if mode not in file_map or not file_map[mode].exists():
        raise HTTPException(status_code=404, detail=f"Unknown mode: {mode}")

    raw = json.loads(file_map[mode].read_text(encoding="utf-8"))
    dataset = WorkspaceDataset(**raw)

    if mode == "paper2sim" and dataset.simulation:
        xs, series = run_heavy_ball_sim()
        dataset.simulation.x = xs
        dataset.simulation.series = series

    return dataset


@router.post("/simulate")
def simulate_paper(params: dict[str, float]):
    gamma = float(params.get("gamma", 0.35))
    eta = float(params.get("eta", 2.4))
    theta0 = float(params.get("theta0", 1.8))
    xs, series = run_heavy_ball_sim(gamma=gamma, eta=eta, theta0=theta0)
    return {"x": xs, "series": [s.model_dump() for s in series]}


def _build_graph_from_chunks(
    title: str, subtitle: str, mode: str, chunks: list[dict[str, str]]
) -> WorkspaceDataset:
    if mode == "paper2sim":
        base = get_demo_dataset("paper2sim")
        base.title = title
        base.subtitle = subtitle
        if base.simulation:
            base.simulation.paper_title = title
            if chunks:
                base.simulation.summary = chunks[0]["summary"]
        return base

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    positions = [(90, 90), (340, 90), (590, 90), (140, 260), (400, 260), (650, 260)]

    for idx, ch in enumerate(chunks[:6]):
        x, y = positions[idx % len(positions)]
        nid = f"u{idx + 1}"
        nodes.append(
            GraphNode(
                id=nid,
                label=ch["label"][:52],
                category="core" if idx > 0 else "prerequisite",
                summary=ch["summary"][:320],
                slide_ref=ch.get("ref", f"Section {idx + 1}"),
                mastery=max(35, 85 - idx * 8),
                x=x,
                y=y,
                quiz=[
                    QuizQuestion(
                        id=f"uq{idx + 1}",
                        question=f"Which best summarizes '{ch['label'][:40]}'?",
                        options=[
                            ch["summary"][:95] + ("..." if len(ch["summary"]) > 95 else ""),
                            "Unrelated background assumption not discussed in this section",
                            "Deprecated baseline method omitted from evaluation",
                        ],
                        correct_index=0,
                        explanation=f"Extracted directly from {ch.get('ref', 'uploaded source')}.",
                    )
                ],
            )
        )
        if idx > 0:
            edge_type = (
                "prerequisite" if mode == "lecture" else ("supports" if idx % 2 == 1 else "contradicts")
            )
            edges.append(
                GraphEdge(
                    id=f"ue{idx}",
                    source=f"u{idx}",
                    target=nid,
                    type=edge_type,
                    label="Builds on"
                    if mode == "lecture"
                    else ("Supports" if edge_type == "supports" else "Contrasts"),
                )
            )

    return WorkspaceDataset(mode=mode, title=title, subtitle=subtitle, nodes=nodes, edges=edges)


@router.post("/ingest/pdf", response_model=WorkspaceDataset)
async def ingest_pdf(file: UploadFile = File(...), mode: str = Form("lecture")):
    raw_bytes = await file.read()
    try:
        doc = pymupdf.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid PDF file: {exc}") from exc

    chunks: list[dict[str, str]] = []
    for i, page in enumerate(doc):
        if len(chunks) >= 6:
            break
        text = page.get_text("text").strip()
        lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) > 3]
        if not lines:
            continue
        label = lines[0]
        summary = " ".join(lines[1:6]) if len(lines) > 1 else lines[0]
        chunks.append({"label": label, "summary": summary, "ref": f"Page {i + 1}"})

    if not chunks:
        chunks = [
            {
                "label": file.filename or "Uploaded Document",
                "summary": "No selectable text found (scanned PDF).",
                "ref": "Page 1",
            }
        ]

    return _build_graph_from_chunks(
        title=file.filename or "Uploaded Lecture PDF",
        subtitle=f"Extracted {len(doc)} pages via PyMuPDF",
        mode=mode,
        chunks=chunks,
    )


@router.post("/ingest/url", response_model=WorkspaceDataset)
def ingest_url(req: UrlIngestRequest):
    raw = req.url.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="URL or arXiv ID is required")

    arxiv_match = re.search(r"(\d{4}\.\d{4,5})(v\d+)?", raw)
    if arxiv_match:
        arxiv_id = arxiv_match.group(1)
        api_url = f"https://export.arxiv.org/api/query?id_list={arxiv_id}"
        try:
            with urllib.request.urlopen(api_url, timeout=8) as resp:
                xml_data = resp.read()
            root = ET.fromstring(xml_data)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            entry = root.find("atom:entry", ns)
            if entry is not None:
                title = (
                    (entry.findtext("atom:title", "", ns) or f"arXiv:{arxiv_id}")
                    .strip()
                    .replace("\n", " ")
                )
                abstract = (entry.findtext("atom:summary", "", ns) or "").strip().replace("\n", " ")
                sentences = [
                    s.strip() for s in re.split(r"(?<=[.!?])\s+", abstract) if len(s.strip()) > 20
                ]
                chunks = [
                    {"label": f"Key Point {i + 1}: {s[:42]}...", "summary": s, "ref": f"arXiv:{arxiv_id}"}
                    for i, s in enumerate(sentences[:5])
                ]
                if not chunks:
                    chunks = [
                        {
                            "label": title,
                            "summary": abstract or "Fetched from arXiv.",
                            "ref": f"arXiv:{arxiv_id}",
                        }
                    ]
                return _build_graph_from_chunks(
                    title=title,
                    subtitle=f"arXiv:{arxiv_id} — Live Abstract Extraction",
                    mode=req.mode,
                    chunks=chunks,
                )
        except Exception:
            pass

    # Fallback for generic URLs or offline mode
    chunks = [
        {"label": f"Source: {raw[:45]}", "summary": f"Ingested URL/topic: {raw}", "ref": "Web Source"},
        {
            "label": "Core Methodology",
            "summary": "Primary claims and mathematical formulation extracted from source.",
            "ref": "Section 2",
        },
        {
            "label": "Empirical Findings",
            "summary": "Experimental results and comparative benchmarks.",
            "ref": "Section 4",
        },
    ]
    return _build_graph_from_chunks(
        title=f"Ingested: {raw[:50]}",
        subtitle="URL / Topic Graph",
        mode=req.mode,
        chunks=chunks,
    )


@router.post("/ask-spatial", response_model=SpatialAskResponse)
def ask_spatial(req: SpatialAskRequest):
    if req.mode == "lecture":
        node_id = req.hit_node_ids[0] if req.hit_node_ids else "n3"
        return SpatialAskResponse(
            spoken_answer=(
                f"You circled node {node_id.upper()}. In deep networks, backpropagating through L layers "
                f"multiplies Jacobians repeatedly—if singular values drop below 1, gradients vanish exponentially. "
                f"Try the quick quiz in the right panel to test this!"
            ),
            avatar_state="explaining",
            annotations=[
                UIAnnotation(type="pulse_node", target_id=node_id, label="Focus Concept"),
            ],
            suggested_quiz_node_id=node_id,
        )

    if req.mode == "paper2sim":
        gamma = (req.sim_params or {}).get("gamma", 0.35)
        eta = (req.sim_params or {}).get("eta", 2.4)
        regime = "underdamped ringing" if gamma < 0.5 else "smooth damped convergence"
        return SpatialAskResponse(
            spoken_answer=(
                f"In the region you circled, the trajectory shows {regime} because γ={gamma:.2f} and η={eta:.1f}. "
                f"Momentum carries θ(t) past the minimum at θ=0 before friction dissipates the kinetic energy."
            ),
            avatar_state="emphatic",
            annotations=[
                UIAnnotation(
                    type="callout_box",
                    x=(req.bbox or {}).get("x", 260),
                    y=(req.bbox or {}).get("y", 140),
                    label=f"Overshoot peak (γ={gamma:.2f})",
                )
            ],
        )

    # hypothesis mode
    node_id = req.hit_node_ids[0] if req.hit_node_ids else "h3"
    return SpatialAskResponse(
        spoken_answer=(
            "This red contradiction edge shows Porz & Bruce (2022) refuting bulk LLZO dendrite suppression "
            "above 0.8 mA/cm²—lithium nucleates inside microscopic grain-boundary flaws. Notice the dashed purple node "
            "below it: sub-1 MPa pulse-annealing remains completely untested."
        ),
        avatar_state="questioning",
        annotations=[
            UIAnnotation(type="pulse_node", target_id=node_id, label="Contradicting Evidence"),
            UIAnnotation(type="pulse_node", target_id="h6", label="Untested Gap"),
        ],
    )
