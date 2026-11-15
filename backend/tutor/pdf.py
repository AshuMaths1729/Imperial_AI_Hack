"""PDF lessons: full-text extraction and knowledge points built from that text (Sonnet, headings as the fallback)."""
import logging
import re
from typing import List, Optional, Tuple

import pymupdf
from pydantic import BaseModel, Field

from .models import KP

log = logging.getLogger("tutor.pdf")

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 60
PROMPT_CHARS = 30000  # PDF text sent to the model when building KPs


class PdfError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status


def _clean(text: str) -> str:
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)  # re-join words hyphenated across a line break
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln and not re.fullmatch(r"(page )?\d{1,3}( of \d{1,3})?", ln, re.I)]
    return "\n".join(lines)


def extract_pages(data: bytes) -> List[str]:
    """-> cleaned text per page. Raises PdfError with the HTTP status to reply with."""
    if len(data) > MAX_BYTES:
        raise PdfError(413, f"PDF is larger than {MAX_BYTES // (1024 * 1024)} MB")
    if not data.startswith(b"%PDF-"):
        raise PdfError(415, "not a PDF file")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as e:
        raise PdfError(415, f"could not read the PDF: {e}")
    with doc:
        if doc.page_count > MAX_PAGES:
            raise PdfError(413, f"PDF has {doc.page_count} pages; the limit is {MAX_PAGES}")
        pages = [_clean(p.get_text("text")) for p in doc]
    if sum(len(p) for p in pages) < 20:
        raise PdfError(422, "this PDF has no selectable text (it looks scanned); upload a text-based PDF")
    return pages


def joined(pages: List[str]) -> str:
    return "\n\n".join(f"[page {i}]\n{p}" for i, p in enumerate(pages, 1) if p)


class _KPIn(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,20}$")
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field("", max_length=400)
    prereq_ids: List[str] = []


class _KPsIn(BaseModel):
    title: str = Field("", max_length=120)
    knowledge_points: List[_KPIn] = Field(min_length=1, max_length=8)


KP_TOOL = {"name": "make_knowledge_points", "description": "Submit the lesson's knowledge points.",
           "input_schema": _KPsIn.model_json_schema()}

KP_SYSTEM = """You turn a student's lecture notes into the knowledge points a live tutor teaches, in order. \
Pitch them at UK A-level (age 16-18) unless the notes are clearly at another level. Give 5 to 8 knowledge points \
that follow the notes' own content and order: each has a short id (k1, k2, ...), a title of 2-6 words, a one- or \
two-sentence summary stating the idea concretely (use the notes' own examples and numbers), and prereq_ids naming \
earlier knowledge points it builds on. Also give a short title for the material. Call make_knowledge_points once."""


def _prefixed(items, prefix: str) -> List[KP]:
    ids = set()
    out = []
    for k in items:
        if k.id in ids:
            continue
        out.append(KP(kp_id=f"{prefix}:{k.id}", title=k.title, summary=k.summary,
                      prereq_ids=[f"{prefix}:{p}" for p in k.prereq_ids if p in ids]))  # earlier KPs only
        ids.add(k.id)
    return out


def llm_kps(pages: List[str], filename: str, prefix: str, llm, model: str) -> Tuple[str, List[KP]]:
    resp = llm({
        "model": model, "max_tokens": 4000, "system": KP_SYSTEM, "tools": [KP_TOOL],
        "tool_choice": {"type": "auto"},  # Sonnet 5.5 rejects a forced tool_choice; the system prompt names it
        "messages": [{"role": "user", "content": f"Notes ({filename}):\n\n{joined(pages)[:PROMPT_CHARS]}"}],
    })
    use = next(b for b in resp.get("content", []) if b.get("type") == "tool_use")
    got = _KPsIn.model_validate(use.get("input"))
    return got.title.strip(), _prefixed(got.knowledge_points, prefix)


def heading_kps(pages: List[str], prefix: str) -> List[KP]:
    """Fallback: the first heading-like line of each page, chained in page order."""
    kps: List[KP] = []
    seen = set()
    for page in pages:
        lines = page.splitlines()
        for i, ln in enumerate(lines):
            if 3 < len(ln) <= 80 and not ln.endswith((".", ",", ";")) and ln.lower() not in seen:
                seen.add(ln.lower())
                kps.append(KP(kp_id=f"{prefix}:k{len(kps) + 1}", title=ln, summary=" ".join(lines[i + 1:i + 4])[:300],
                              prereq_ids=[kps[-1].kp_id] if kps else []))
                break
        if len(kps) == 8:
            break
    return kps


def build_kps(pages: List[str], filename: str, prefix: str, llm, model: str) -> Tuple[Optional[str], List[KP]]:
    """-> (title or None, KPs). Never raises because of the model: falls back to headings."""
    try:
        return llm_kps(pages, filename, prefix, llm, model)
    except Exception:  # API error, no tool call, or invalid input
        log.exception("KP generation failed for %s; using headings", filename)
        return None, heading_kps(pages, prefix)
