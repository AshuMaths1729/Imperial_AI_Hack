import json
import math
from pathlib import Path
from typing import Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import (
    WorkspaceDataset,
    SpatialAskRequest,
    SpatialAskResponse,
    UIAnnotation,
    SimulationSeries,
)

app = FastAPI(title="ScholarTwin API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEMO_DIR = Path(__file__).parent / "demo_data"


def run_heavy_ball_sim(gamma: float = 0.35, eta: float = 2.4, theta0: float = 1.8, steps: int = 180):
    dt = 0.08
    xs = [round(i * dt, 2) for i in range(steps)]
    theta = [0.0] * steps
    vel = [0.0] * steps
    energy = [0.0] * steps
    envelope = [0.0] * steps

    theta[0] = theta0
    energy[0] = round(0.5 * (theta0 ** 2), 4)
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


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ScholarTwin Phase 1"}


@app.get("/api/demo/{mode}", response_model=WorkspaceDataset)
def get_demo_dataset(mode: str):
    file_map = {
        "lecture": DEMO_DIR / "lecture_demo.json",
        "paper2sim": DEMO_DIR / "paper2sim_demo.json",
        "hypothesis": DEMO_DIR / "hypothesis_demo.json",
    }
    if mode not in file_map or not file_map[mode].exists():
        raise HTTPException(status_code=404, detail=f"Unknown mode: {mode}")

    raw = json.loads(file_map[mode].read_text())
    dataset = WorkspaceDataset(**raw)

    if mode == "paper2sim" and dataset.simulation:
        xs, series = run_heavy_ball_sim()
        dataset.simulation.x = xs
        dataset.simulation.series = series

    return dataset


@app.post("/api/simulate")
def simulate_paper(params: Dict[str, float]):
    gamma = float(params.get("gamma", 0.35))
    eta = float(params.get("eta", 2.4))
    theta0 = float(params.get("theta0", 1.8))
    xs, series = run_heavy_ball_sim(gamma=gamma, eta=eta, theta0=theta0)
    return {"x": xs, "series": [s.model_dump() for s in series]}


@app.post("/api/ask-spatial", response_model=SpatialAskResponse)
def ask_spatial(req: SpatialAskRequest):
    q = req.transcript.strip() or "Explain what I circled here."

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
