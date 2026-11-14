from typing import Literal

from pydantic import BaseModel, Field


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class GraphNode(BaseModel):
    id: str
    label: str
    category: Literal["core", "prerequisite", "claim", "paper", "gap"] = "core"
    summary: str
    slide_ref: str | None = None          # e.g., "Slide 14 (08:42)" or "arXiv:2401.11234"
    authors_year: str | None = None       # For HypothesisGraph papers
    mastery: int = Field(default=65, ge=0, le=100)
    x: float = 0.0
    y: float = 0.0
    quiz: list[QuizQuestion] = []


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: Literal["prerequisite", "supports", "contradicts", "gap"]
    label: str | None = None
    condition: str | None = None          # e.g., "Refutes under high current density (>2 mA/cm²)"


class SimulationParam(BaseModel):
    name: str
    key: str
    min_val: float
    max_val: float
    step: float
    default_val: float
    unit: str = ""


class SimulationSeries(BaseModel):
    name: str
    color: str
    y: list[float]


class SimulationPayload(BaseModel):
    paper_title: str
    arxiv_id: str
    equation_latex: str
    summary: str
    python_code: str
    params: list[SimulationParam]
    x_label: str
    y_label: str
    x: list[float]
    series: list[SimulationSeries]


class WorkspaceDataset(BaseModel):
    mode: Literal["lecture", "paper2sim", "hypothesis"]
    title: str
    subtitle: str
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    simulation: SimulationPayload | None = None


class UrlIngestRequest(BaseModel):
    url: str
    mode: Literal["lecture", "paper2sim", "hypothesis"] = "lecture"


class SpatialAskRequest(BaseModel):
    mode: Literal["lecture", "paper2sim", "hypothesis"]
    transcript: str
    bbox: dict[str, float] | None = None  # {x, y, w, h}
    hit_node_ids: list[str] = []
    hit_edge_ids: list[str] = []
    sim_params: dict[str, float] | None = None
    cropped_image_b64: str | None = None


class UIAnnotation(BaseModel):
    type: Literal["pulse_node", "highlight_edge", "callout_box"]
    target_id: str | None = None
    x: float | None = None
    y: float | None = None
    label: str


class SpatialAskResponse(BaseModel):
    spoken_answer: str
    avatar_state: Literal["explaining", "emphatic", "questioning"] = "explaining"
    annotations: list[UIAnnotation] = []
    suggested_quiz_node_id: str | None = None
