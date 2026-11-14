"""PDF -> title / abstract / method text via PyMuPDF heuristics. No LLM. Equations are not
reliably recoverable from PDF text, so callers leave `equations` empty."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

from app.modules.paper_ingest.selection import METHOD_BUDGET, Chunk, select_sections

MAX_PAGES = 80
MAX_CHARS = 600_000

_NUMBERED = re.compile(
    r"^(?:\d{1,2}(?:\.\d{1,2}){0,2}\.?|[IVX]{1,5}\.)\s+[A-Z][A-Za-z0-9 ,:;\-–&'/()]{2,80}$"
)
_NAMED = re.compile(
    r"^(?:abstract|introduction|methods?|methodology|model|background|related work|"
    r"conclusions?|references|discussion|experiments?|results|appendix|acknowledg\w*)\b.{0,60}$",
    re.IGNORECASE,
)
_MATHY = re.compile(r"[=∂∑∫∇≤≥≈∞λαβθ]")


class PdfError(Exception):
    pass


@dataclass
class PdfResult:
    title: str = ""
    authors: list[str] = field(default_factory=list)
    abstract: str = ""
    method_text: str = ""
    truncated: bool = False
    pages: int = 0


def _first_page_title(page: pymupdf.Page) -> str:
    spans: list[tuple[float, float, str]] = []  # (size, y, text) per line
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            txt = " ".join(s["text"].strip() for s in line["spans"] if s["text"].strip())
            if txt:
                size = max(s["size"] for s in line["spans"])
                spans.append((size, line["bbox"][1], txt))
    if not spans:
        return ""
    biggest = max(s for s, _, _ in spans)
    lines = [t for s, _, t in spans if s >= 0.9 * biggest][:3]
    return " ".join(" ".join(lines).split())[:300]


def _abstract(text: str) -> str:
    m = re.search(
        r"(?is)\babstract\b[\s.:—\-]*(.{150,3000}?)"
        r"(?=\n\s*(?:\d\.?\s*|I\.\s*)?introduction\b|\n\s*(?:index terms|keywords?)\b|\Z)",
        text,
    )
    return " ".join(m.group(1).split())[:3000] if m else ""


def _chunks(text: str) -> list[Chunk]:
    lines = text.split("\n")
    heads = [
        i
        for i, ln in enumerate(lines)
        if len(ln.strip()) < 90 and (_NUMBERED.match(ln.strip()) or _NAMED.match(ln.strip()))
    ]
    if len(heads) < 3:
        return [Chunk("document", text, math=sum(1 for ln in lines if _MATHY.search(ln)))]
    chunks: list[Chunk] = []
    bounds = [*heads, len(lines)]
    for a, b in zip(bounds, bounds[1:], strict=False):
        body = "\n".join(lines[a:b]).strip()
        math = sum(1 for ln in lines[a:b] if _MATHY.search(ln) and len(ln) < 120)
        chunks.append(Chunk(lines[a].strip(), body, math=math))
    return chunks


def parse_pdf(data: bytes, *, budget: int = METHOD_BUDGET) -> PdfResult:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as e:  # pymupdf raises its own FileDataError / RuntimeError
        raise PdfError(f"cannot open PDF: {e}") from e
    with doc:
        total_pages = doc.page_count
        n = min(total_pages, MAX_PAGES)
        if n == 0:
            raise PdfError("PDF has no pages")
        pages = [doc[i].get_text("text") for i in range(n)]
        title = _first_page_title(doc[0])
        meta = doc.metadata or {}
    text = "\n".join(pages)[:MAX_CHARS]
    text = re.sub(r"-\n(?=[a-z])", "", text)  # undo line-end hyphenation
    if not text.strip():
        raise PdfError("PDF has no extractable text (scanned?)")
    authors = [a.strip() for a in re.split(r"[;,]| and ", meta.get("author") or "") if a.strip()]
    method, truncated = select_sections(_chunks(text), budget)
    return PdfResult(
        title=title or (meta.get("title") or "").strip(),
        authors=authors,
        abstract=_abstract("\n".join(pages[:2])),
        method_text=method,
        truncated=truncated or total_pages > n,
        pages=n,
    )
