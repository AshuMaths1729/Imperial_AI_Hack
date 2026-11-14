"""PDF -> per-page text, page PNGs and thumbnails under `state_dir/docs/{doc_id}/`.

Layout (the quiz module reads `pages.json` by this convention):
    meta.json         {doc_id, filename, page_count, total_pages, truncated}
    pages.json        ["text of page 1", ...]
    page-{n}.png      110 dpi         thumb-{n}.png   48 dpi
    source.pdf        the upload as received
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pymupdf

from app.core.errors import AppError

MAX_PAGES = 100
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
FULL_DPI = 110
THUMB_DPI = 48
DOC_ID_RE = re.compile(r"^[0-9a-f]{12}$")


class InvalidUpload(AppError):
    code = "invalid_upload"
    status_code = 400


def doc_id_for(pdf: bytes) -> str:
    return hashlib.sha256(pdf).hexdigest()[:12]


def docs_dir(state_dir: Path, doc_id: str) -> Path:
    return state_dir / "docs" / doc_id


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_meta(state_dir: Path, doc_id: str) -> dict[str, Any] | None:
    path = docs_dir(state_dir, doc_id) / "meta.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def process_pdf(pdf: bytes, state_dir: Path, filename: str = "") -> dict[str, Any]:
    """Extract text + render images (idempotent: skipped when `meta.json` already exists)."""
    if not pdf.startswith(b"%PDF"):
        raise InvalidUpload("File is not a PDF")
    if len(pdf) > MAX_UPLOAD_BYTES:
        raise InvalidUpload("PDF is larger than 30 MB", status_code=413)
    doc_id = doc_id_for(pdf)
    existing = read_meta(state_dir, doc_id)
    if existing:
        return existing
    try:
        doc = pymupdf.open(stream=pdf, filetype="pdf")
    except Exception as exc:  # pymupdf raises its own FileDataError etc.
        raise InvalidUpload("Could not read the PDF") from exc
    out = docs_dir(state_dir, doc_id)
    with doc:
        total = doc.page_count
        if total == 0:
            raise InvalidUpload("PDF has no pages")
        count = min(total, MAX_PAGES)
        out.mkdir(parents=True, exist_ok=True)
        texts: list[str] = []
        for i in range(count):
            page = doc[i]
            texts.append(page.get_text().strip())
            page.get_pixmap(dpi=FULL_DPI).save(str(out / f"page-{i + 1}.png"))
            page.get_pixmap(dpi=THUMB_DPI).save(str(out / f"thumb-{i + 1}.png"))
    (out / "source.pdf").write_bytes(pdf)
    write_json(out / "pages.json", texts)
    meta = {
        "doc_id": doc_id,
        "filename": filename,
        "page_count": count,
        "total_pages": total,
        "truncated": total > count,
    }
    write_json(out / "meta.json", meta)  # written last: its presence marks a complete doc
    return meta


def pdf_for_llm(pdf: bytes, page_count: int, total_pages: int) -> bytes:
    """The PDF to send to the model: the original, or its first `page_count` pages."""
    if page_count >= total_pages:
        return pdf
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        doc.select(list(range(page_count)))
        return doc.tobytes()
