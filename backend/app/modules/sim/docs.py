"""Turn the LLM's draft docs into `SimDocs`, checked against the FINAL validated simulation.

`sanitize_docs` is pure and deterministic. It never trusts the model's cross-references:
anything pointing at a slider or series the validated code doesn't have is dropped (or
repaired), the concept graph always has a `"paper"` root and exactly one `parameter` node per
PARAMS key, links only join existing concepts and form a DAG flowing down from the root, every
concept is reachable from the root, and every preset sets every slider to an in-range value.
Short labels (concept labels, relations, preset names) are made LaTeX-free (`plain_label`).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Hashable, Iterable, Mapping
from typing import TypeVar

from app.modules.sim.models import (
    ConceptDoc,
    ConceptLink,
    CoreDocsDraft,
    DerivationStep,
    DraftSource,
    EquationDoc,
    EquationVar,
    GraphDocsDraft,
    ParamDoc,
    SeriesDoc,
    SimDocs,
    SimPreset,
    SourceLoc,
)
from app.schemas.sim import ParamSpec, SimOutput

T = TypeVar("T")
ROOT_ID = "paper"
MAX_QUOTE = 400  # SourceLoc.quote max_length
_DELIMS = (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$"))
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_ORPHAN_RELATION = {
    "model": "proposes the model",
    "cited_work": "builds on",
    "assumption": "relies on the assumption",
    "result": "predicts",
    "parameter": "is tuned by",
}


_SYMBOLS = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε",
    "zeta": "ζ", "eta": "η", "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ",
    "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ",
    "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "φ", "chi": "χ", "psi": "ψ",
    "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ",
    "Pi": "Π", "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω", "infty": "∞", "cdot": "·",
    "times": "×", "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "approx": "≈",
    "to": "→", "rightarrow": "→", "partial": "∂", "nabla": "∇", "sqrt": "√", "sum": "Σ",
}  # fmt: skip
_SUB = dict(
    zip("0123456789+-=()aehijklmnoprstuvx", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ", strict=True)
)
_SUP = dict(zip("0123456789+-=()in", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ", strict=True))
# a command swallows the following space only before a lone symbol: "\Delta t" -> "Δt"
_CMD_RE = re.compile(r"\\([A-Za-z]+)(?: (?=[A-Za-z](?![A-Za-z])))?")
_SCRIPT_RE = re.compile(r"([_^])(?:\{([^{}]*)\}|([A-Za-z0-9])(?![A-Za-z]))")
_LATEXY = re.compile(r"[$\\_^{}]")


# ------------------------------------------------------------------------------- helpers
def plain_label(text: str) -> str:
    """LaTeX-ish short label -> plain Unicode: "$S_0$" -> "S₀", "\\Delta t" -> "Δt", "x^2" ->
    "x²". Labels are also shown where no LaTeX is rendered (slider names, tooltips, legends)."""
    if not _LATEXY.search(text):
        return text.strip()
    s = text.replace("$", "")
    s = _CMD_RE.sub(lambda m: _SYMBOLS.get(m.group(1), ""), s)

    def script(m: re.Match[str]) -> str:
        body = m.group(2) if m.group(2) is not None else m.group(3)
        table = _SUB if m.group(1) == "_" else _SUP
        if body and all(ch in table for ch in body):
            return "".join(table[ch] for ch in body)
        return body or ""

    s = _SCRIPT_RE.sub(script, s)
    s = re.sub(r"[_^]", " ", s.replace("{", "").replace("}", "").replace("\\", ""))
    return re.sub(r"\s+", " ", s).strip()


def strip_math_delims(latex: str) -> str:
    """`$x$`, `$$x$$`, `\\(x\\)`, `\\[x\\]` -> `x` (the frontend renders bare LaTeX)."""
    s = latex.strip()
    for left, right in _DELIMS:
        if len(s) > len(left) + len(right) and s.startswith(left) and s.endswith(right):
            return s[len(left) : len(s) - len(right)].strip()
    return s


def _source(src: DraftSource | SourceLoc | None) -> SourceLoc | None:
    """Empty location -> None; a page below 1 is "unknown"; over-long quotes are cut."""
    if src is None:
        return None
    page = src.page if src.page is not None and src.page >= 1 else None
    section, quote = src.section.strip(), src.quote.strip()
    if len(quote) > MAX_QUOTE:
        quote = quote[: MAX_QUOTE - 1].rstrip() + "…"
    if not section and not quote and page is None:
        return None
    return SourceLoc(section=section, page=page, quote=quote)


def _first_sentence(text: str) -> str:
    text = text.strip()
    return _SENTENCE_RE.split(text, maxsplit=1)[0] if text else ""


def _unique_id(base: str, taken: set[str]) -> str:
    cand, n = base, 2
    while cand in taken:
        cand, n = f"{base}_{n}", n + 1
    return cand


def _dedupe(items: Iterable[T], key: Callable[[T], Hashable]) -> list[T]:
    seen: set[Hashable] = set()
    out: list[T] = []
    for it in items:
        k = key(it)
        if k in seen:
            continue
        seen.add(k)
        out.append(it)
    return out


def _var(v: EquationVar) -> EquationVar:
    return EquationVar(symbol_latex=strip_math_delims(v.symbol_latex), meaning=v.meaning.strip())


def _reaches(adj: Mapping[str, set[str]], start: str, goal: str) -> bool:
    stack, seen = [start], {start}
    while stack:
        node = stack.pop()
        if node == goal:
            return True
        for nxt in adj.get(node, ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return False


# ------------------------------------------------------------------------------ concepts
def _concepts(
    graph: GraphDocsDraft, params: Mapping[str, ParamSpec]
) -> tuple[list[ConceptDoc], dict[str, str]]:
    """Dedupe ids, make the paper node `"paper"`, fix `param_key`s. Returns (concepts, id remap)."""
    remap: dict[str, str] = {}
    out: list[ConceptDoc] = []
    ids: set[str] = set()
    claimed: set[str] = set()
    has_root = any(c.id.strip() == ROOT_ID for c in graph.concepts)
    for c in graph.concepts:
        cid, label = c.id.strip(), plain_label(c.label)
        if not cid or not label or cid in ids:
            continue
        kind = c.kind
        if kind == "paper" and not has_root:
            remap[cid], cid, has_root = ROOT_ID, ROOT_ID, True
        elif kind == "paper" and cid != ROOT_ID:
            kind = "cited_work"  # a second "paper" node is a cited work
        if cid == ROOT_ID:
            kind = "paper"
        pk: str | None = c.param_key.strip()
        if pk not in params or pk in claimed:
            pk = None
        if pk is None and kind == "parameter":
            kind = "variable"  # a slider-less "parameter" is just a quantity of the model
        if pk is not None:
            claimed.add(pk)
            kind = "parameter"
        ids.add(cid)
        out.append(
            ConceptDoc(
                id=cid,
                label=label,
                kind=kind,
                summary=c.summary.strip(),
                detail=c.detail.strip(),
                latex=strip_math_delims(c.latex),
                param_key=pk,
                source=_source(c.source),
            )
        )
    return out, remap


def _model_anchor(concepts: list[ConceptDoc]) -> str:
    return next((c.id for c in concepts if c.kind == "model"), ROOT_ID)


def _ensure_root(concepts: list[ConceptDoc], paper_title: str, overview: str) -> list[ConceptDoc]:
    if any(c.id == ROOT_ID for c in concepts):
        return concepts
    root = ConceptDoc(
        id=ROOT_ID,
        label=plain_label(paper_title) or "Source paper",
        kind="paper",
        summary=_first_sentence(overview) or "The paper this simulation is built from.",
        detail=overview.strip(),
    )
    return [root, *concepts]


def _ensure_param_concepts(
    concepts: list[ConceptDoc],
    params: Mapping[str, ParamSpec],
    param_docs: Mapping[str, ParamDoc],
) -> tuple[list[ConceptDoc], list[ConceptLink]]:
    covered = {c.param_key for c in concepts if c.param_key}
    ids = {c.id for c in concepts}
    anchor = _model_anchor(concepts)
    new_concepts: list[ConceptDoc] = []
    new_links: list[ConceptLink] = []
    for key, spec in params.items():
        if key in covered:
            continue
        doc = param_docs.get(key)
        label = plain_label(spec.label) or key
        cid = _unique_id(f"param_{key}", ids)
        ids.add(cid)
        new_concepts.append(
            ConceptDoc(
                id=cid,
                label=label,
                kind="parameter",
                summary=(doc.meaning if doc else "") or f"The '{label}' slider.",
                detail=doc.effect if doc else "",
                latex=doc.symbol_latex if doc else "",
                param_key=key,
                source=doc.source if doc else None,
            )
        )
        new_links.append(
            ConceptLink(
                source=anchor,
                target=cid,
                relation="is tuned by",
                explanation=f"The '{label}' slider sets this value in the simulation.",
            )
        )
    return [*concepts, *new_concepts], new_links


# --------------------------------------------------------------------------------- links
def _links(
    links: Iterable[ConceptLink], order: list[str], remap: Mapping[str, str]
) -> list[ConceptLink]:
    """Keep links between known concepts, in order, skipping self-loops, duplicates, links into
    the paper root (it is the top of the graph) and any link that would close a cycle (the
    graph tab lays links out as a top-down DAG)."""
    adj: dict[str, set[str]] = {}
    out: list[ConceptLink] = []
    rank = {cid: i for i, cid in enumerate(order)}

    def backward(link: ConceptLink) -> bool:
        """A parent listed after its child goes against the declared top-down order: such
        links are only kept when they fit after all the forward ones."""
        src = rank.get(remap.get(link.source.strip(), link.source.strip()), len(rank))
        return src >= rank.get(remap.get(link.target.strip(), link.target.strip()), -1)

    for link in sorted(links, key=backward):  # stable: forward links first, in order
        src = remap.get(link.source.strip(), link.source.strip())
        dst = remap.get(link.target.strip(), link.target.strip())
        relation = plain_label(link.relation)
        if src not in rank or dst not in rank or src == dst or dst == ROOT_ID or not relation:
            continue
        if dst in adj.get(src, set()) or _reaches(adj, dst, src):
            continue
        adj.setdefault(src, set()).add(dst)
        out.append(
            ConceptLink(
                source=src,
                target=dst,
                relation=relation,
                explanation=link.explanation.strip(),
                kind=link.kind,
            )
        )
    return out


def _connect(concepts: list[ConceptDoc], links: list[ConceptLink]) -> list[ConceptLink]:
    """Make every concept reachable from the root. A concept with no incoming link gets a
    parent (models and cited works hang off the root, everything else off the first model);
    then whatever is still cut off (a parentless island) is hung off the root."""
    adj: dict[str, set[str]] = {}
    for link in links:
        adj.setdefault(link.source, set()).add(link.target)
    has_parent = {link.target for link in links}
    anchor = _model_anchor(concepts)
    extra: list[ConceptLink] = []

    def add(parent: str, child: ConceptDoc) -> None:
        if parent != ROOT_ID and _reaches(adj, child.id, parent):
            parent = ROOT_ID  # the root has no incoming links, so this never closes a cycle
        adj.setdefault(parent, set()).add(child.id)
        has_parent.add(child.id)
        extra.append(
            ConceptLink(
                source=parent,
                target=child.id,
                relation=_ORPHAN_RELATION.get(child.kind, "involves"),
            )
        )

    for c in concepts:
        if c.id == ROOT_ID or c.id in has_parent:
            continue
        add(ROOT_ID if c.kind in ("model", "cited_work") or c.id == anchor else anchor, c)
    for c in concepts:  # cycles among parented nodes can still be unreachable from the root
        if c.id != ROOT_ID and not _reaches(adj, ROOT_ID, c.id):
            add(ROOT_ID, c)
    return [*links, *extra]


# ---------------------------------------------------------------------------------- main
def sanitize_docs(
    core: CoreDocsDraft | None,
    graph: GraphDocsDraft | None,
    params: Mapping[str, ParamSpec],
    output: SimOutput,
    paper_title: str = "",
) -> SimDocs | None:
    """Build `SimDocs` from the codegen `core` and the optional `graph` drafts, consistent
    with the validated `params` / default `output` (see module docstring)."""
    if core is None:
        return None
    graph = graph or GraphDocsDraft(equations=[], derivation=[], glossary=[], concepts=[])
    series_names = {s.name for s in output.series}

    param_docs = _dedupe(
        (
            ParamDoc(
                key=d.key,
                symbol_latex=strip_math_delims(d.symbol_latex),
                meaning=d.meaning.strip(),
                effect=d.effect.strip(),
                typical=d.typical.strip(),
                source=_source(d.source),
            )
            for d in core.params
            if d.key in params
        ),
        key=lambda d: d.key,
    )
    series_docs = _dedupe(
        (
            SeriesDoc(name=s.name, meaning=s.meaning.strip(), how_to_read=s.how_to_read.strip())
            for s in core.series
            if s.name in series_names
        ),
        key=lambda s: s.name,
    )

    concepts, remap = _concepts(graph, params)
    concepts = _ensure_root(concepts, paper_title, core.overview)
    concepts, param_links = _ensure_param_concepts(concepts, params, {d.key: d for d in param_docs})
    raw_links = [  # each concept lists its incoming links
        ConceptLink(
            source=p.source,
            target=c.id,
            relation=p.relation,
            explanation=p.explanation,
            kind=p.kind,
        )
        for c in graph.concepts
        for p in c.parents
    ]
    links = _connect(concepts, _links([*raw_links, *param_links], [c.id for c in concepts], remap))

    # a ParamDoc without a location borrows its parameter concept's
    concept_src = {c.param_key: c.source for c in concepts if c.param_key and c.source}
    param_docs = [
        d if d.source else d.model_copy(update={"source": concept_src.get(d.key)})
        for d in param_docs
    ]

    equations = _dedupe(
        (
            EquationDoc(
                id=e.id.strip() or f"eq_{i + 1}",
                title=plain_label(e.title),
                latex=strip_math_delims(e.latex),
                explanation=e.explanation.strip(),
                variables=[_var(v) for v in e.variables],
                source=_source(e.source),
            )
            for i, e in enumerate(graph.equations)
            if e.latex.strip()
        ),
        key=lambda e: e.id,
    )
    derivation = [
        DerivationStep(
            title=plain_label(d.title),
            latex=strip_math_delims(d.latex),
            explanation=d.explanation.strip(),
        )
        for d in graph.derivation
    ]

    return SimDocs(
        overview=core.overview.strip(),
        key_findings=[f.strip() for f in core.key_findings if f.strip()],
        params=param_docs,
        concepts=concepts,
        links=links,
        equations=equations,
        derivation=derivation,
        presets=_presets(core, params),
        series=series_docs,
        x_meaning=core.x_meaning.strip(),
        y_meaning=core.y_meaning.strip(),
        limitations=[x.strip() for x in core.limitations if x.strip()],
        glossary=_dedupe(
            (_var(v) for v in graph.glossary if v.symbol_latex.strip()),
            key=lambda v: v.symbol_latex,
        ),
    )


def _presets(core: CoreDocsDraft, params: Mapping[str, ParamSpec]) -> list[SimPreset]:
    """Known keys only, clamped into range, unset sliders at their default; presets that set
    no known slider (or repeat a name) are dropped."""
    out: list[SimPreset] = []
    names: set[str] = set()
    for p in core.presets:
        name = plain_label(p.name)
        given = {v.key: v.value for v in p.values if v.key in params}
        if not name or name in names or not given:
            continue
        names.add(name)
        out.append(
            SimPreset(
                name=name,
                description=p.description.strip(),
                params={
                    key: float(min(max(given.get(key, spec.default), spec.min), spec.max))
                    for key, spec in params.items()
                },
                expected=p.expected.strip(),
                source=_source(p.source),
            )
        )
    return out
