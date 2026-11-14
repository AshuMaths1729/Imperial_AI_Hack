from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: List[str]
    correct_index: int
    explanation: str


class GraphNode(BaseModel):
    id: str
    label: str
    category: Literal["core", "prerequisite", "claim", "paper", "gap"] = "core"
    summary: str
    slide_ref: Optional[str] = None          # e.g., "Slide 14 (08:42)" or "arXiv:2401.11234"
    authors_year: Optional[str] = None       # For HypothesisGraph papers
    mastery: int = Field(default=65, ge=0, le=100)
    x: float = 0.0
    y: float = 0.0
    quiz: List[QuizQuestion] = []


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: Literal["prerequisite", "supports", "contradicts", "gap"]
    label: Optional[str] = None
    condition: Optional[str] = None          # e.g., "Refutes under high current density (>2 mA/cm²)"


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
    y: List[float]


class SimulationPayload(BaseModel):
    paper_title: str
    arxiv_id: str
    equation_latex: str
    summary: str
    python_code: str
    params: List[SimulationParam]
    x_label: str
    y_label: str
    x: List[float]
    series: List[SimulationSeries]


class WorkspaceDataset(BaseModel):
    mode: Literal["lecture", "paper2sim", "hypothesis"]
    title: str
    subtitle: str
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    simulation: Optional[SimulationPayload] = None


class SpatialAskRequest(BaseModel):
    mode: Literal["lecture", "paper2sim", "hypothesis"]
    transcript: str
    bbox: Optional[Dict[str, float]] = None  # {x, y, w, h}
    hit_node_ids: List[str] = []
    hit_edge_ids: List[str] = []
    sim_params: Optional[Dict[str, float]] = None
    cropped_image_b64: Optional[str] = None


class UIAnnotation(BaseModel):
    type: Literal["pulse_node", "highlight_edge", "callout_box"]
    target_id: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    label: str


class SpatialAskResponse(BaseModel):
    spoken_answer: str
    avatar_state: Literal["explaining", "emphatic", "questioning"] = "explaining"
    annotations: List[UIAnnotation] = []
    suggested_quiz_node_id: Optional[str] = None
