"""Section scoring/selection and display-math extraction shared by the LaTeX, PDF and HTML
paths. Deterministic, no LLM."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.modules.paper_ingest.models import Equation

METHOD_BUDGET = 40_000
MAX_EQUATIONS = 200

_POS = (
    "method", "model", "approach", "algorithm", "theory", "theoretical", "ode", "equation",
    "derivation", "dynamic", "formulation", "framework", "continuous", "setup",
    "problem", "preliminar", "notation", "scheme", "system", "simulation", "discrete",
    "convergence", "analysis", "background", "main", "result", "limit",
)  # fmt: skip
_NEG = (
    "related", "introduction", "experiment", "conclusion", "discussion", "acknowledg",
    "future", "limitation", "bibliograph", "reference", "numerical", "overview",
)  # fmt: skip
_EXCLUDE = re.compile(
    r"^(references?|bibliography|acknowledg\w*|funding|author contributions|declarations?"
    r"|competing interests)\b",
    re.IGNORECASE,
)


@dataclass
class Chunk:
    title: str
    text: str
    parent: str = ""  # enclosing section title (subsections inherit its keywords)
    math: int = 0  # number of display equations (or equation-like lines for PDFs)
    appendix: bool = False  # appendix material fills leftover budget only


def score_chunk(c: Chunk) -> float:
    words = re.findall(r"[a-z]+", f"{c.parent} {c.title}".lower())
    pos = sum(1 for w in words if any(w.startswith(s) for s in _POS))
    neg = sum(1 for w in words if any(w.startswith(s) for s in _NEG))
    density = c.math / max(len(c.text) / 1000.0, 1.0)
    body = re.findall(r"[a-z]+", c.text[:20_000].lower())
    kw = min(sum(1 for w in body if w in ("ode", "dynamics", "derivation", "equation")), 30)
    s = 4.0 * pos - 3.0 * neg + 0.5 * min(c.math, 30) + 3.0 * min(density, 4.0) + 0.1 * kw
    if c.appendix or re.match(r"(?i)^(appendix|supplement)", c.title.strip()):
        s -= 25.0
    return s


def _cut(text: str, n: int) -> str:
    cut = text[:n]
    k = max(cut.rfind("\n\n"), cut.rfind("\n"))
    if k > n * 0.5:
        cut = cut[:k]
    return cut.rstrip() + "\n[... truncated ...]"


def select_sections(chunks: list[Chunk], budget: int = METHOD_BUDGET) -> tuple[str, bool]:
    """Greedy by score under a character budget; output keeps document order.
    Returns (text, truncated) where truncated means relevant content was cut or dropped."""
    cands = [
        (i, c)
        for i, c in enumerate(chunks)
        if c.text.strip() and not _EXCLUDE.match(c.title.strip())
    ]
    chosen: dict[int, str] = {}
    remaining = budget
    truncated = False
    for i, c in sorted(cands, key=lambda ic: -score_chunk(ic[1])):
        n = len(c.text)
        if n <= remaining:
            chosen[i] = c.text
            remaining -= n + 2
        elif remaining > 1500:
            chosen[i] = _cut(c.text, remaining)
            remaining = 0
            truncated = True
        elif n > 300:
            truncated = True
    return "\n\n".join(chosen[i] for i in sorted(chosen)), truncated


# --- display math -----------------------------------------------------------------------

_EQ_ENV = re.compile(
    r"\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|displaymath)\}"
    r"(.*?)\\end\{\1\}",
    re.DOTALL,
)
_EQ_BRACKET = re.compile(r"\\\[(.*?)\\\]", re.DOTALL)
_EQ_DOLLAR = re.compile(r"(?<!\\)\$\$(.*?)(?<!\\)\$\$", re.DOTALL)
_LABEL = re.compile(r"\\label\s*\{([^{}]*)\}")


def _display_matches(text: str) -> list[tuple[int, int, str]]:
    found: list[tuple[int, int, str]] = []
    for m in _EQ_ENV.finditer(text):
        found.append((m.start(), m.end(), m.group(2)))
    for rx in (_EQ_BRACKET, _EQ_DOLLAR):
        for m in rx.finditer(text):
            found.append((m.start(), m.end(), m.group(1)))
    found.sort()
    out: list[tuple[int, int, str]] = []
    last_end = -1
    for s, e, body in found:  # drop matches nested inside an earlier one
        if s >= last_end:
            out.append((s, e, body))
            last_end = e
    return out


def count_display_math(text: str) -> int:
    return len(_display_matches(text))


def extract_equations(text: str, *, context_chars: int = 200) -> list[Equation]:
    eqs: list[Equation] = []
    for s, _e, body in _display_matches(text):
        label_m = _LABEL.search(body)
        latex = _LABEL.sub("", body).strip()
        if not latex:
            continue
        ctx = " ".join(text[max(0, s - 3 * context_chars) : s].split())[-context_chars:]
        if len(ctx) == context_chars and " " in ctx:
            ctx = ctx.split(" ", 1)[1]
        eqs.append(
            Equation(label=label_m.group(1) if label_m else None, latex=latex[:4000], context=ctx)
        )
        if len(eqs) >= MAX_EQUATIONS:
            break
    return eqs
