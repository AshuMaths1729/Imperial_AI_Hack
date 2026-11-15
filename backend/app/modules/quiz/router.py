"""On-click adaptive quiz: generate MCQs for a node, grade answers, track EMA mastery."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends
from pydantic import Field, model_validator

from app.core.errors import NotFound, SchemaValidationError
from app.deps import get_llm, get_settings
from app.llm.client import LLMClient
from app.modules.quiz import store
from app.modules.quiz.prompts import PROMPT_VERSION, QUIZ_PROMPT, REL_TEXT
from app.schemas.base import StrictModel
from app.schemas.graph import Graph, Node
from app.settings import Settings

router = APIRouter(tags=["quiz"])

N_QUESTIONS = 3
PAGE_TEXT_LIMIT = 4000


class QuizQuestionDraft(StrictModel):
    question: str
    options: list[str] = Field(description="Exactly 4 answer options")
    correct_index: int = Field(description="0-3, index of the correct option")
    explanation: str

    @model_validator(mode="after")
    def _check(self) -> QuizQuestionDraft:
        if len(self.options) != 4:
            raise ValueError("each question needs exactly 4 options")
        if not 0 <= self.correct_index <= 3:
            raise ValueError("correct_index must be 0-3")
        return self


class QuizDraft(StrictModel):
    questions: list[QuizQuestionDraft]


class QuizQuestion(StrictModel):
    id: str
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class QuizResponse(StrictModel):
    graph_id: str
    node_id: str
    questions: list[QuizQuestion]


class AnswerRequest(StrictModel):
    question_id: str
    choice: int = Field(ge=0, le=3)


class AnswerResponse(StrictModel):
    correct: bool
    explanation: str
    mastery: float


class MasteryEntry(StrictModel):
    node_id: str
    label: str
    mastery: float
    attempts: int


class MasteryResponse(StrictModel):
    graph_id: str
    nodes: list[MasteryEntry]


class NextResponse(StrictModel):
    graph_id: str
    node_id: str
    label: str
    mastery: float
    attempts: int


def _find_node(graph: Graph, node_id: str) -> Node:
    for n in graph.nodes:
        if n.id == node_id:
            return n
    raise NotFound(f"Unknown node {node_id!r} in graph {graph.graph_id!r}")


def _quiz_content(settings: Settings, graph: Graph, node: Node) -> str:
    by_id = {n.id: n for n in graph.nodes}
    lines = [f"Concept: {node.label}", f"Summary: {node.summary or '(none)'}"]
    related: list[str] = []
    for e in graph.edges:
        if e.target == node.id and e.source in by_id:
            other = by_id[e.source]
            rel = REL_TEXT["prerequisite_in"] if e.type == "prerequisite" else REL_TEXT[e.type]
        elif e.source == node.id and e.target in by_id:
            other = by_id[e.target]
            rel = REL_TEXT["prerequisite_out"] if e.type == "prerequisite" else REL_TEXT[e.type]
        else:
            continue
        related.append(f"- {other.label} {rel}: {other.summary}")
    if related:
        lines += ["Neighbouring concepts:", *related]
    ref = node.source_ref
    if ref and ref.page:
        text = " ".join(store.page_text(settings, ref.doc_id, ref.page).split())
        if text:
            lines += [f"Slide text (page {ref.page}):", text[:PAGE_TEXT_LIMIT]]
    return "\n".join(lines)


def _question_id(graph_id: str, node_id: str, question: str) -> str:
    return "q_" + hashlib.sha256(f"{graph_id}|{node_id}|{question}".encode()).hexdigest()[:8]


@router.get("/quiz/{graph_id}/next", response_model=NextResponse)
async def next_node(graph_id: str, settings: Settings = Depends(get_settings)) -> NextResponse:
    """The weakest node: lowest mastery (unseen = 0), then fewest attempts, then graph order."""
    graph = store.load_graph(settings, graph_id)
    state = store.read_mastery(settings, graph_id)
    pool = [n for n in graph.nodes if n.kind == "concept"] or graph.nodes
    if not pool:
        raise NotFound("Graph has no nodes")

    def score(n: Node) -> tuple[float, int]:
        e = state.get(n.id) or {}
        return (e.get("mastery", 0.0), e.get("attempts", 0))

    node = min(pool, key=score)  # min() keeps the first of equals -> graph order tiebreak
    m, attempts = score(node)
    return NextResponse(
        graph_id=graph_id, node_id=node.id, label=node.label, mastery=m, attempts=attempts
    )


@router.get("/quiz/{graph_id}/{node_id}", response_model=QuizResponse)
async def get_quiz(
    graph_id: str,
    node_id: str,
    settings: Settings = Depends(get_settings),
    llm: LLMClient = Depends(get_llm),
) -> QuizResponse:
    graph = store.load_graph(settings, graph_id)
    node = _find_node(graph, node_id)
    cached = store.read_quiz(settings, graph_id, node_id)
    if cached is None:
        result = await llm.parse(
            "quiz.gen",
            QUIZ_PROMPT,
            _quiz_content(settings, graph, node),
            QuizDraft,
            prompt_version=PROMPT_VERSION,
        )
        drafts = result.output.questions[:N_QUESTIONS]
        if not drafts:
            raise SchemaValidationError("Quiz generation returned no questions")
        cached = [
            QuizQuestion(
                id=_question_id(graph_id, node_id, d.question), **d.model_dump()
            ).model_dump()
            for d in drafts
        ]
        store.write_quiz(settings, graph_id, node_id, cached)
    return QuizResponse(
        graph_id=graph_id,
        node_id=node_id,
        questions=[QuizQuestion.model_validate(q) for q in cached],
    )


@router.post("/quiz/{graph_id}/{node_id}/answer", response_model=AnswerResponse)
async def answer(
    graph_id: str,
    node_id: str,
    body: AnswerRequest,
    settings: Settings = Depends(get_settings),
) -> AnswerResponse:
    store.load_graph(settings, graph_id)
    questions = store.read_quiz(settings, graph_id, node_id)
    if questions is None:
        raise NotFound("No quiz generated for this node yet; GET it first")
    q = next((q for q in questions if q["id"] == body.question_id), None)
    if q is None:
        raise NotFound(f"Unknown question {body.question_id!r}")
    correct = body.choice == q["correct_index"]
    mastery = store.record_answer(settings, graph_id, node_id, correct)
    return AnswerResponse(correct=correct, explanation=q["explanation"], mastery=mastery)


@router.get("/mastery/{graph_id}", response_model=MasteryResponse)
async def get_mastery(graph_id: str, settings: Settings = Depends(get_settings)) -> MasteryResponse:
    graph = store.load_graph(settings, graph_id)
    state = store.read_mastery(settings, graph_id)
    return MasteryResponse(
        graph_id=graph_id,
        nodes=[
            MasteryEntry(
                node_id=n.id,
                label=n.label,
                mastery=(state.get(n.id) or {}).get("mastery", 0.0),
                attempts=(state.get(n.id) or {}).get("attempts", 0),
            )
            for n in graph.nodes
        ],
    )
