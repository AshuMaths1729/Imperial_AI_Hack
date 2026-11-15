"""`sanitize_docs`: deterministic clean-up of the LLM's draft docs against the validated sim."""

from __future__ import annotations

import json

import anthropic
import pytest
from app.modules.sim.docs import ROOT_ID, plain_label, sanitize_docs, strip_math_delims
from app.modules.sim.models import (
    CoreDocsDraft,
    GraphDocsDraft,
    RepairDraft,
    SimDocs,
    SimDraft,
)
from app.schemas.sim import ParamSpec, SimOutput

PARAMS = {
    "k": ParamSpec(min=0.0, max=2.0, default=1.0, step=0.1, unit="1/s", label="Rate k"),
    "n": ParamSpec(min=1, max=10, default=3, step=1, unit="steps", label="Steps n"),
}
OUTPUT = SimOutput(
    title="t",
    x_label="x",
    y_label="y",
    series=[{"name": "Model", "x": [0.0, 1.0], "y": [0.0, 1.0]}],
)
NO_SRC = {"section": "", "page": 0, "quote": ""}


def src(section="", page=0, quote=""):
    return {"section": section, "page": page, "quote": quote}


def concept(cid, kind, param_key="", source=NO_SRC, label=None):
    return {
        "id": cid,
        "label": label or cid,
        "kind": kind,
        "summary": "s",
        "detail": "",
        "latex": "",
        "param_key": param_key,
        "source": source,
    }


def link(s, t, relation="leads to"):
    return {
        "source": s,
        "target": t,
        "relation": relation,
        "explanation": "",
        "kind": "prerequisite",
    }


def core(**over) -> CoreDocsDraft:
    base = {
        "overview": "Things decay. This paper says how fast.",
        "key_findings": ["fast", " "],
        "params": [
            {
                "key": "k",
                "symbol_latex": "$k$",
                "meaning": "rate",
                "effect": "faster",
                "typical": "",
                "source": NO_SRC,
            },
            {
                "key": "ghost",
                "symbol_latex": "",
                "meaning": "",
                "effect": "",
                "typical": "",
                "source": NO_SRC,
            },
            {
                "key": "k",
                "symbol_latex": "",
                "meaning": "dup",
                "effect": "",
                "typical": "",
                "source": NO_SRC,
            },
        ],
        "presets": [
            {
                "name": "Fast",
                "description": "d",
                "values": [{"key": "k", "value": 99.0}, {"key": "zz", "value": 1.0}],
                "expected": "steep",
                "source": src("4 Results", 5, "x" * 500),
            },
            {
                "name": "Unknown only",
                "description": "d",
                "values": [{"key": "zz", "value": 1}],
                "expected": "",
                "source": NO_SRC,
            },
            {
                "name": "Fast",
                "description": "dup",
                "values": [{"key": "k", "value": 0.5}],
                "expected": "",
                "source": NO_SRC,
            },
        ],
        "series": [
            {"name": "Model", "meaning": "the model", "how_to_read": ""},
            {"name": "Renamed in repair", "meaning": "stale", "how_to_read": ""},
        ],
        "x_meaning": "time",
        "y_meaning": "amount",
        "limitations": ["toy"],
    }
    base.update(over)
    return CoreDocsDraft.model_validate(base)


def graph(concepts=None, links=None, **over) -> GraphDocsDraft:
    """Links are written as (source, target) for readability and moved into the target
    concept's `parents` (the draft shape); the first concept with that id gets them."""
    base = {
        "concepts": [
            concept("root", "paper", label="Decay paper"),
            concept("model", "model"),
            concept("param_k", "parameter", "k", src("2 Model", 3, " a quote ")),
            concept("bogus", "parameter", "zz"),
            concept("result", "result"),
            concept("model", "concept"),  # duplicate id
            concept("other_paper", "paper"),
        ],
        "links": [
            link("root", "model", "proposes"),
            link("model", "param_k", "is tuned by"),
            link("param_k", "result", "speeds up"),
            link("result", "model", "loops back"),  # would close a cycle
            link("nowhere", "model"),  # unknown parent
            link("model", "root", "into root"),
            link("model", "model", "self"),
            link("model", "result", " "),  # empty relation
        ],
        "equations": [
            {
                "id": "e1",
                "title": "Main",
                "latex": "$$y = k t$$",
                "explanation": "e",
                "variables": [{"symbol_latex": "$k$", "meaning": "rate"}],
                "source": NO_SRC,
            },
            {
                "id": "e1",
                "title": "dup",
                "latex": "z",
                "explanation": "",
                "variables": [],
                "source": NO_SRC,
            },
            {
                "id": "e2",
                "title": "empty",
                "latex": " ",
                "explanation": "",
                "variables": [],
                "source": NO_SRC,
            },
        ],
        "derivation": [{"title": "Start", "latex": "\\(a\\)", "explanation": "x"}],
        "glossary": [
            {"symbol_latex": "k", "meaning": "rate"},
            {"symbol_latex": "k", "meaning": "d"},
        ],
    }
    base.update(over)
    cs = [dict(c, parents=[]) for c in (base["concepts"] if concepts is None else concepts)]
    for lk in base["links"] if links is None else links:
        target = next(c for c in cs if c["id"] == lk["target"])
        target["parents"].append({k: lk[k] for k in ("source", "relation", "explanation", "kind")})
    base["concepts"] = cs
    del base["links"]
    return GraphDocsDraft.model_validate(base)


def run(c=None, g=None, title="T") -> SimDocs:
    out = sanitize_docs(c if c is not None else core(), g, PARAMS, OUTPUT, title)
    assert out is not None
    return out


def is_dag_from_root(out: SimDocs) -> bool:
    ids = {c.id for c in out.concepts}
    indeg = dict.fromkeys(ids, 0)
    for lk in out.links:
        indeg[lk.target] += 1
    queue = [i for i, d in indeg.items() if d == 0]
    seen = 0
    while queue:
        node = queue.pop()
        seen += 1
        for lk in out.links:
            if lk.source == node:
                indeg[lk.target] -= 1
                if indeg[lk.target] == 0:
                    queue.append(lk.target)
    reach, stack = {ROOT_ID}, [ROOT_ID]
    while stack:
        node = stack.pop()
        for lk in out.links:
            if lk.source == node and lk.target not in reach:
                reach.add(lk.target)
                stack.append(lk.target)
    return seen == len(ids) and reach == ids  # acyclic, and everything hangs off the root


def test_none_core_stays_none():
    assert sanitize_docs(None, graph(), PARAMS, OUTPUT, "T") is None


def test_core_fields_cleaned_against_params_and_series():
    out = run(g=graph())
    assert [p.key for p in out.params] == ["k"]
    assert out.params[0].symbol_latex == "k"
    assert [s.name for s in out.series] == ["Model"]
    assert out.key_findings == ["fast"]
    # ParamDoc without a location borrows the parameter concept's
    assert out.params[0].source.section == "2 Model" and out.params[0].source.page == 3


def test_presets_clamped_completed_deduped_and_quotes_cut():
    out = run()
    assert [p.name for p in out.presets] == ["Fast"]
    preset = out.presets[0]
    assert preset.params == {"k": 2.0, "n": 3.0}
    assert preset.expected == "steep"
    assert preset.source.page == 5 and len(preset.source.quote) <= 400


def test_paper_node_renamed_to_root_and_links_remapped():
    out = run(g=graph())
    by_id = {c.id: c for c in out.concepts}
    assert "root" not in by_id and by_id[ROOT_ID].kind == "paper"
    assert by_id[ROOT_ID].label == "Decay paper"
    assert by_id["other_paper"].kind == "cited_work"
    assert [c.id for c in out.concepts].count("model") == 1
    assert (ROOT_ID, "model") in {(lk.source, lk.target) for lk in out.links}


def test_links_known_acyclic_reachable_and_never_into_root():
    out = run(g=graph())
    ids = {c.id for c in out.concepts}
    pairs = [(lk.source, lk.target) for lk in out.links]
    assert all(s in ids and t in ids and s != t for s, t in pairs)
    assert all(t != ROOT_ID for _, t in pairs)
    assert ("result", "model") not in pairs
    assert len(pairs) == len(set(pairs))
    assert {t for _, t in pairs} == ids - {ROOT_ID}  # every non-root node has a parent
    assert all(lk.relation.strip() for lk in out.links)
    assert is_dag_from_root(out)


def test_every_param_gets_exactly_one_parameter_concept():
    out = run(g=graph())
    by_key: dict = {}
    for c in out.concepts:
        if c.param_key:
            assert c.kind == "parameter" and c.param_key not in by_key
            by_key[c.param_key] = c
    assert set(by_key) == {"k", "n"}
    assert by_key["n"].label == "Steps n"  # synthesised from PARAMS
    assert ("model", by_key["n"].id) in {(lk.source, lk.target) for lk in out.links}
    bogus = next(c for c in out.concepts if c.id == "bogus")
    assert bogus.param_key is None and bogus.kind == "variable"
    assert by_key["k"].source.quote == "a quote"


def test_page_zero_and_empty_sources_become_none():
    out = run(g=graph())
    model = next(c for c in out.concepts if c.id == "model")
    assert model.source is None


def test_equations_derivation_glossary_cleaned():
    out = run(g=graph())
    assert [e.id for e in out.equations] == ["e1"]
    assert out.equations[0].latex == "y = k t"
    assert out.equations[0].variables[0].symbol_latex == "k"
    assert out.derivation[0].latex == "a"
    assert len(out.glossary) == 1


def test_no_graph_synthesises_root_and_parameter_nodes():
    out = run(g=None, title="My Paper")
    assert [c.id for c in out.concepts] == [ROOT_ID, "param_k", "param_n"]
    root = out.concepts[0]
    assert root.label == "My Paper" and root.summary == "Things decay."
    assert {(lk.source, lk.target) for lk in out.links} == {
        (ROOT_ID, "param_k"),
        (ROOT_ID, "param_n"),
    }
    assert out.concepts[1].summary == "rate"  # from the ParamDoc
    assert out.equations == [] and out.presets[0].name == "Fast"


def test_root_synthesised_and_model_attached_when_graph_has_no_paper_node():
    g = graph(concepts=[concept("model", "model"), concept("x", "concept")], links=[])
    out = run(g=g, title="")
    assert out.concepts[0].id == ROOT_ID and out.concepts[0].label == "Source paper"
    pairs = {(lk.source, lk.target) for lk in out.links}
    assert {(ROOT_ID, "model"), ("model", "x"), ("model", "param_k"), ("model", "param_n")} <= pairs


def test_cut_off_cycle_island_is_hung_off_the_root():
    # a <-> b only: the a->b link survives, b->a is dropped; a then needs a parent
    g = graph(
        concepts=[concept("paper", "paper"), concept("a", "concept"), concept("b", "concept")],
        links=[link("a", "b"), link("b", "a")],
    )
    out = run(g=g)
    assert is_dag_from_root(out)
    pairs = {(lk.source, lk.target) for lk in out.links}
    assert ("a", "b") in pairs and ("b", "a") not in pairs
    assert any(t == "a" for _, t in pairs)


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("$x$", "x"),
        (" $$ a+b $$ ", "a+b"),
        ("\\(y\\)", "y"),
        ("\\[z\\]", "z"),
        ("a $b$ c", "a $b$ c"),
        ("$", "$"),
    ],
)
def test_strip_math_delims(raw, clean):
    assert strip_math_delims(raw) == clean


@pytest.mark.parametrize("model", [SimDraft, GraphDocsDraft, RepairDraft])
def test_llm_schemas_have_no_optional_or_free_form_objects(model):
    """Structured outputs compile the schema into a grammar with a size limit, and optional /
    nullable fields blow it up (the API answers 400 "compiled grammar is too large"); a
    `dict[str, X]` compiles to an always-empty `{}`. The LLM-facing drafts avoid both."""
    schema = anthropic.transform_schema(model)
    bad: list[str] = []

    def walk(node, path):
        if isinstance(node, dict):
            if node.get("type") == "object":
                props = node.get("properties") or {}
                if not props:
                    bad.append(f"{path}: empty object")
                missing = set(props) - set(node.get("required", []))
                if missing:
                    bad.append(f"{path}: optional {sorted(missing)}")
            if "anyOf" in node:
                bad.append(f"{path}: anyOf")
            for k, v in node.items():
                walk(v, f"{path}/{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{path}/{i}")

    walk(schema, "")
    assert not bad, json.dumps(bad, indent=1)


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("$S_0$", "S₀"),
        ("Initial strength S_0", "Initial strength S₀"),
        (r"Recall interval $\Delta$", "Recall interval Δ"),
        (r"\Delta t", "Δt"),
        (r"$\theta$ threshold", "θ threshold"),
        (r"Rate \lambda (1/s)", "Rate λ (1/s)"),
        ("x^2", "x²"),
        ("a^{-1}", "a⁻¹"),
        ("S_{max}", "Sₘₐₓ"),
        ("n_layers", "n layers"),
        ("Retention R(t)", "Retention R(t)"),
    ],
)
def test_plain_label(raw, clean):
    assert plain_label(raw) == clean


def test_short_labels_are_latex_free():
    g = graph(
        concepts=[
            concept("paper", "paper", label="$S_0$ paper"),
            concept("model", "model", label="Decay of $R$"),
        ],
        links=[link("paper", "model", "sets $S_0$ for")],
    )
    c = core(
        presets=[
            {
                "name": "Large $S_0$",
                "description": "keeps $S_0 = 8$",
                "values": [{"key": "k", "value": 1.0}],
                "expected": "",
                "source": NO_SRC,
            }
        ]
    )
    params = {**PARAMS, "n": PARAMS["n"].model_copy(update={"label": "Steps $n_0$"})}
    out = sanitize_docs(c, g, params, OUTPUT, "T")
    labels = [x.label for x in out.concepts] + [lk.relation for lk in out.links]
    labels += [p.name for p in out.presets]
    assert not [x for x in labels if any(ch in x for ch in "$\\_^{}")], labels
    assert out.links[0].relation == "sets S₀ for"
    assert next(x for x in out.concepts if x.param_key == "n").label == "Steps n₀"
    assert out.presets[0].description == "keeps $S_0 = 8$"  # prose keeps its inline math
