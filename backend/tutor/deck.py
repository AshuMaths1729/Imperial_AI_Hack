"""Animated slide decks: schema, validation, Sonnet generation (before the lesson) and per-track caching.

The pydantic models below are the deck contract. frontend/src/tutor/slides/deck.schema.json is generated from
them (`python -m tutor.deck > ../frontend/src/tutor/slides/deck.schema.json`, checked by test_deck.py) and
mirrored by hand in frontend/src/tutor/slides/types.ts.
"""
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Callable, List, Literal, Optional, Tuple, Union

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .models import Track

log = logging.getLogger("tutor.deck")

MODEL = "claude-sonnet-5-5"
ROOT = Path(__file__).resolve().parents[2]
SLIDES_DIR = ROOT / "frontend/src/tutor/slides"
FALLBACK_DIR = SLIDES_DIR / "decks"
DEMO_DIR = Path(__file__).resolve().parents[1] / "demo_data"
STALE_S = 600  # a "generating" doc older than this was orphaned (e.g. server restart): allow a new run

Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
Color = Literal["blue", "teal", "green", "yellow", "gold", "red", "purple", "pink", "white", "grey"]
Vec = Tuple[float, float]
Short = Annotated[str, Field(max_length=120)]


class _Obj(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Id
    color: Optional[Color] = None


class Text(_Obj):
    """Plain text. x,y is its centre (left edge when align=left), in canvas units, or axes units if `axes` is set."""
    kind: Literal["text"]
    text: Annotated[str, Field(max_length=300)]
    x: float
    y: float
    size: float = Field(32, ge=12, le=96)
    align: Literal["center", "left"] = "center"
    axes: Optional[Id] = None


class Math(_Obj):
    """A KaTeX formula, positioned like text. Colour parts with \\color{#58C4DD}{...}."""
    kind: Literal["math"]
    latex: Annotated[str, Field(max_length=400)]
    x: float
    y: float
    size: float = Field(40, ge=12, le=110)
    align: Literal["center", "left"] = "center"
    axes: Optional[Id] = None


class Axes(_Obj):
    """A coordinate frame: x,y,w,h is its box on the canvas; ranges are in maths units."""
    kind: Literal["axes"]
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    x_range: Vec
    y_range: Vec
    x_label: Short = ""
    y_label: Short = ""


class Curve(_Obj):
    """y = expr(x) on an axes. expr: x (+ slider params), + - * / ^, sin cos tan exp log sqrt abs, PI, E."""
    kind: Literal["curve"]
    axes: Id
    expr: Annotated[str, Field(max_length=200)]
    x_range: Optional[Vec] = None
    label: Short = ""


class Polyline(_Obj):
    kind: Literal["polyline"]
    points: Annotated[List[Vec], Field(min_length=2, max_length=200)]
    axes: Optional[Id] = None


class Dot(_Obj):
    """A point at x on a curve (y follows the curve) or at (x, y). Animate it with move/path actions."""
    kind: Literal["dot"]
    axes: Id
    x: float
    curve: Optional[Id] = None
    y: Optional[float] = None
    label: Short = ""


class Vector(_Obj):
    kind: Literal["vector"]
    start: Vec
    end: Vec
    axes: Optional[Id] = None
    label: Short = ""


class Tangent(_Obj):
    """The tangent line of `curve` at `dot`; follows the dot as it moves. length in axes x-units."""
    kind: Literal["tangent"]
    curve: Id
    dot: Id
    length: float = Field(2, gt=0)


class StepArrow(_Obj):
    """Horizontal arrow from the dot to where one gradient step goes: length = -scale * slope. Follows the dot."""
    kind: Literal["step_arrow"]
    dot: Id
    scale: float = Field(1, gt=0)
    label: Short = ""


class Shape(_Obj):
    kind: Literal["shape"]
    shape: Literal["rect", "ellipse", "line"]
    x: float
    y: float
    w: float
    h: float
    axes: Optional[Id] = None
    fill: bool = False


class Slider(_Obj):
    """A control the student can drag. Curves may use `param` in expr; dots on those curves follow."""
    kind: Literal["slider"]
    param: Annotated[str, Field(pattern=r"^[a-wyz]$")]
    min: float
    max: float
    value: float
    x: float
    y: float
    w: float = Field(360, gt=0)
    label: Short = ""


SlideObject = Annotated[
    Union[Text, Math, Axes, Curve, Polyline, Dot, Vector, Tangent, StepArrow, Shape, Slider],
    Field(discriminator="kind"),
]


class _Act(BaseModel):
    model_config = ConfigDict(extra="forbid")
    with_prev: bool = False  # run together with the previous action instead of after it


class Show(_Act):
    do: Literal["show"]
    ids: Annotated[List[Id], Field(min_length=1, max_length=20)]


class Hide(_Act):
    do: Literal["hide"]
    ids: Annotated[List[Id], Field(min_length=1, max_length=20)]


class Move(_Act):
    do: Literal["move"]
    id: Id
    to: float


class PathAct(_Act):
    do: Literal["path"]
    id: Id
    xs: Annotated[List[float], Field(min_length=1, max_length=60)]
    trail: bool = True


class Morph(_Act):
    do: Literal["morph"]
    id: Id
    latex: Optional[Annotated[str, Field(max_length=400)]] = None
    expr: Optional[Annotated[str, Field(max_length=200)]] = None


class Indicate(_Act):
    do: Literal["indicate"]
    ids: Annotated[List[Id], Field(min_length=1, max_length=20)]


Action = Annotated[Union[Show, Hide, Move, PathAct, Morph, Indicate], Field(discriminator="do")]


class Step(BaseModel):
    model_config = ConfigDict(extra="forbid")
    narration: Annotated[str, Field(max_length=300)]
    actions: Annotated[List[Action], Field(max_length=12)]


class Slide(BaseModel):
    """Objects not named by any show action are visible when the slide opens; the rest appear at their step."""
    model_config = ConfigDict(extra="forbid")
    id: Id
    title: Annotated[str, Field(max_length=80)]
    kp_ids: List[str] = []
    objects: Annotated[List[SlideObject], Field(min_length=1, max_length=40)]
    steps: Annotated[List[Step], Field(max_length=12)] = []


class Deck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Annotated[str, Field(max_length=120)]
    slides: Annotated[List[Slide], Field(min_length=1, max_length=12)]


_FUNCS = {"sin", "cos", "tan", "exp", "log", "sqrt", "abs", "PI", "E", "x"}
_TOKEN = re.compile(r"\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_]\w*)|([-+*/^(),]))")


def expr_error(expr: str, params: set) -> Optional[str]:
    pos = 0
    while pos < len(expr):
        m = _TOKEN.match(expr, pos)
        if not m or m.end() == pos:
            if expr[pos:].strip() == "":
                break
            return f"bad character in expr {expr!r} at {pos}"
        if m.group(2) and m.group(2) not in _FUNCS | params:
            return f"unknown name {m.group(2)!r} in expr {expr!r}"
        pos = m.end()
    return None


def slide_errors(s: Slide) -> List[str]:
    """Cross-references the schema can't express. Empty list = renderable."""
    errs: List[str] = []
    objs = {}
    for o in s.objects:
        if o.id in objs:
            errs.append(f"slide {s.id}: duplicate object id {o.id}")
        objs[o.id] = o
    params = {o.param for o in s.objects if isinstance(o, Slider)}

    def ref(owner: str, rid: Optional[str], kind, need=True):
        if rid is None:
            if need:
                errs.append(f"slide {s.id}: {owner} needs a {kind.__name__.lower()}")
            return
        if not isinstance(objs.get(rid), kind):
            errs.append(f"slide {s.id}: {owner} refers to {rid}, which is not a {kind.__name__.lower()} on this slide")

    for o in s.objects:
        if isinstance(o, (Text, Math, Polyline, Vector, Shape)):
            ref(o.id, o.axes, Axes, need=False)
        if isinstance(o, Axes) and not (o.x_range[0] < o.x_range[1] and o.y_range[0] < o.y_range[1]):
            errs.append(f"slide {s.id}: axes {o.id} ranges must be [low, high]")
        if isinstance(o, Curve):
            ref(o.id, o.axes, Axes)
            if e := expr_error(o.expr, params):
                errs.append(f"slide {s.id}: {e}")
        if isinstance(o, Dot):
            ref(o.id, o.axes, Axes)
            if o.curve is None and o.y is None:
                errs.append(f"slide {s.id}: dot {o.id} needs a curve or a y")
            ref(o.id, o.curve, Curve, need=False)
        if isinstance(o, Tangent):
            ref(o.id, o.curve, Curve)
            ref(o.id, o.dot, Dot)
        if isinstance(o, StepArrow):
            ref(o.id, o.dot, Dot)
            if isinstance(objs.get(o.dot), Dot) and objs[o.dot].curve is None:
                errs.append(f"slide {s.id}: step_arrow {o.id} needs a dot that sits on a curve")

    for i, st in enumerate(s.steps, 1):
        for a in st.actions:
            where = f"slide {s.id} step {i} {a.do}"
            for rid in getattr(a, "ids", None) or [a.id]:
                if rid not in objs:
                    errs.append(f"{where}: unknown object {rid}")
            if isinstance(a, (Move, PathAct)) and a.id in objs and not isinstance(objs[a.id], Dot):
                errs.append(f"{where}: {a.id} is not a dot")
            if isinstance(a, Morph) and a.id in objs:
                o = objs[a.id]
                if isinstance(o, Math) and a.latex:
                    continue
                if isinstance(o, Curve) and a.expr:
                    if e := expr_error(a.expr, params):
                        errs.append(f"{where}: {e}")
                    continue
                errs.append(f"{where}: morph needs latex for a math object or expr for a curve")
    return errs


def deck_errors(deck: Deck) -> List[str]:
    errs = []
    seen = set()
    for s in deck.slides:
        if s.id in seen:
            errs.append(f"duplicate slide id {s.id}")
        seen.add(s.id)
        errs += slide_errors(s)
    return errs


def parse_deck(raw, kp_ids: Optional[List[str]] = None) -> Tuple[Optional[Deck], List[str], List[str]]:
    """-> (deck, errors, missing_kps). Unknown kp_ids on slides are dropped, not errors."""
    try:
        deck = Deck.model_validate(raw)
    except ValidationError as e:
        return None, [f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:20]], []
    errs = deck_errors(deck)
    missing: List[str] = []
    if kp_ids is not None:
        known = set(kp_ids)
        for s in deck.slides:
            s.kp_ids = [k for k in s.kp_ids if k in known]
        covered = {k for s in deck.slides for k in s.kp_ids}
        missing = [k for k in kp_ids if k not in covered]
    return deck, errs, missing


def fallback_deck(track_id: str) -> Optional[dict]:
    """Hand-made deck shipped for a track (the demo), so the showcase never depends on generation."""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", track_id):
        return None
    p = FALLBACK_DIR / f"{track_id}.json"
    return json.loads(p.read_text()) if p.exists() else None


def materials_text(track: Track, limit: int = 12000) -> str:
    """What the student uploaded, as prompt text. Only demo datasets are stored in full; others give their KPs."""
    parts = []
    for m in track.materials:
        parts.append(f"Material ({m.kind}): {m.dataset_title}")
        if m.kind == "demo" and re.fullmatch(r"[a-z0-9_]+", m.ref) and (DEMO_DIR / f"{m.ref}.json").exists():
            d = json.loads((DEMO_DIR / f"{m.ref}.json").read_text())
            parts.append(f"{d.get('title', '')} — {d.get('subtitle', '')}")
            for n in d.get("nodes", []):
                parts.append(f"- {n.get('label')}: {n.get('summary', '')}")
                for q in n.get("quiz", [])[:1]:
                    parts.append(f"  quiz: {q.get('question')} (answer: {q['options'][q['correct_index']]})")
    return "\n".join(parts)[:limit]


SYSTEM = """You design short animated lesson decks in the style of 3Blue1Brown: every slide builds intuition \
with a picture that moves, before any formula. A live voice tutor presents your deck, stepping through the \
animation while speaking, and points a laser at objects by id.

Principles:
- Intuition first: open with a concrete picture or analogy, then name it, then the equation. One idea per slide.
- Show, don't write: few words on screen (titles of 2-6 words, labels of 1-4 words); the tutor says the rest.
- Motion carries meaning: a dot rolling down a curve, a tangent riding along, an equation appearing piece by piece.
- Consistent colour = consistent meaning across the deck (e.g. blue for parameters, yellow for the gradient, \
green for the goal, red for warnings).
- 3 to 6 steps per slide. Each step's narration is one short spoken sentence for the tutor (a hint, not a script).
- Cover every required knowledge point (list its id in kp_ids of the slide that teaches it), in prerequisite order. \
5 to 8 slides; the last slide recaps.

Palette (`color` names; use the hex in latex as \\color{#hex}{...}): blue #58C4DD, teal #5CD0B3, green #83C167, \
yellow #FFE45C, gold #F0AC5F, red #FC6255, purple #B08CD9, pink #E072C8, white #ECECEC, grey #8A8F98.
Canvas: 1600 x 900 units, origin top-left, dark background. The slide title is drawn for you at the top \
(keep content below y=150). Leave 60 units of margin. Text sizes: 28-40; math 36-64.
Objects (all need a unique id per slide):
- text/math: x,y = centre (or left edge with align=left). With `axes`, x,y are in that axes' maths units.
- axes: x,y,w,h = box on the canvas; x_range/y_range in maths units. Draw curves, dots, vectors inside it.
- curve: expr in x (and slider params), operators + - * / ^, functions sin cos tan exp log sqrt abs, PI, E.
- dot: on a curve at x (y follows the curve), or at (x, y). Animate with move (to x) or path (hop through xs, \
e.g. successive gradient-descent iterates you computed exactly).
- tangent: tangent line of a curve at a dot; follows the dot. step_arrow: horizontal arrow from a dot of length \
-scale*slope (one gradient step with learning rate = scale); follows the dot.
- vector/polyline/shape: in canvas units, or axes units with `axes`.
- slider: a draggable control for a one-letter parameter used in curve exprs (makes the slide interactive).
Actions per step (run in order; with_prev=true runs with the previous action): show (draws/writes objects in), \
hide, move, path, morph (math -> new latex, or curve -> new expr), indicate (briefly highlight).
Objects never named by a show action are visible as soon as the slide opens, so show most objects in steps.
Compute any numbers (iterates, function values) exactly; make sure dots and labels sit inside their axes."""


def build_prompt(track: Track) -> str:
    kps = "\n".join(
        f"- {k.kp_id}: {k.title} — {k.summary}" + (f" (after {', '.join(k.prereq_ids)})" if k.prereq_ids else "")
        for k in track.knowledge_points
    )
    return (
        f"Topic: {track.title}\n\nRequired knowledge points:\n{kps or '(none listed)'}\n\n"
        f"Student's materials:\n{materials_text(track) or '(none)'}\n\n"
        "Make the deck. Call make_deck once."
    )


def deck_tool() -> dict:
    schema = Deck.model_json_schema()
    return {"name": "make_deck", "description": "Submit the animated deck.", "input_schema": schema}


LLM = Callable[[dict], dict]  # Anthropic Messages request body -> response JSON


def anthropic_llm(body: dict) -> dict:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        json=body,
        timeout=300,
    )
    r.raise_for_status()
    return r.json()


def generate_deck(track: Track, llm: LLM, attempts: int = 2) -> Tuple[dict, List[str]]:
    """-> (deck JSON, warnings). Retries once with the validation errors; raises if no renderable deck."""
    tool = deck_tool()
    messages: list = [{"role": "user", "content": build_prompt(track)}]
    kp_ids = [k.kp_id for k in track.knowledge_points]
    deck, errs, missing = None, ["no make_deck call"], []
    for _ in range(attempts):
        resp = llm({
            "model": MODEL, "max_tokens": 16000, "system": SYSTEM, "tools": [tool],
            "tool_choice": {"type": "auto"}, "messages": messages,  # Sonnet 5.5 rejects a forced tool_choice; SYSTEM names it
        })
        use = next((b for b in resp.get("content", []) if b.get("type") == "tool_use"), None)
        if use is None:
            continue
        deck, errs, missing = parse_deck(use.get("input"), kp_ids)
        if deck is not None and not errs and not missing:
            return deck.model_dump(exclude_none=True), []
        problems = errs + [f"knowledge point {k} is not covered by any slide's kp_ids" for k in missing]
        messages += [
            {"role": "assistant", "content": resp["content"]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": use["id"], "is_error": True,
                                          "content": "Fix these problems and call make_deck again:\n" + "\n".join(problems[:30])}]},
        ]
    if deck is not None and not errs:  # only coverage gaps left: still a good deck
        return deck.model_dump(exclude_none=True), [f"not covered: {k}" for k in missing]
    raise ValueError("deck generation failed: " + "; ".join(errs[:5]))


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_stale(doc: dict) -> bool:
    try:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(doc["updated_at"])
    except (KeyError, ValueError):
        return True
    return age.total_seconds() > STALE_S


def deck_view(track_id: str, doc: Optional[dict]) -> dict:
    """GET reply: generation status + the best deck to teach from now (generated, else the shipped fallback)."""
    doc = doc or {}
    deck, source = doc.get("deck"), "generated"
    if deck is None:
        deck, source = fallback_deck(track_id), "fallback"
    return {
        "status": doc.get("status", "none"),
        "source": source if deck is not None else None,
        "deck": deck,
        "error": doc.get("error", ""),
        "warnings": doc.get("warnings", []),
        "updated_at": doc.get("updated_at"),
    }


def run_generation(store, track_id: str, llm: LLM) -> None:
    """Background job: generate, then cache on the track's deck doc. Keeps the previous deck if it fails."""
    prev = store.get_deck(track_id) or {}
    try:
        track = store.get_track(track_id)
        deck, warnings = generate_deck(track, llm)
        store.save_deck(track_id, {"status": "ready", "deck": deck, "error": "", "warnings": warnings, "updated_at": now()})
    except Exception as e:
        log.exception("deck generation failed for %s", track_id)
        store.save_deck(track_id, {**prev, "status": "failed", "error": str(e)[:300], "updated_at": now()})


if __name__ == "__main__":
    json.dump(Deck.model_json_schema(), sys.stdout, indent=2)
    sys.stdout.write("\n")
