"""Orchestration: arXiv / PDF / URL -> `PaperSource`, plus persistence under
`settings.state_dir/paper_sources/{paper_id}.json`. No LLM calls; all fetched content is
untrusted data that is parsed, never executed."""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlparse

import anyio.to_thread
import httpx

from app.core.errors import AppError, NotFound
from app.modules.paper_ingest.latex import LatexError, process_latex, unpack_eprint
from app.modules.paper_ingest.models import PaperSource
from app.modules.paper_ingest.pdf import PdfError, parse_pdf
from app.modules.paper_ingest.selection import METHOD_BUDGET, extract_equations
from app.modules.paper_ingest.webpage import HTML_CAP_BYTES, html_to_text
from app.tools.scholarly import arxiv

log = logging.getLogger(__name__)
T = TypeVar("T")

MAX_PDF_BYTES = 50 * 1024 * 1024
_ID_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,120}$")


class IngestError(AppError):
    code = "ingest_bad_request"
    status_code = 400


async def _thread(fn: Callable[..., T], *args: object) -> T:
    return await anyio.to_thread.run_sync(fn, *args)


# --- ids ------------------------------------------------------------------------------------


def sha12(data: bytes | str) -> str:
    b = data.encode() if isinstance(data, str) else data
    return hashlib.sha256(b).hexdigest()[:12]


def arxiv_paper_id(arxiv_id: str) -> str:
    return "arxiv_" + arxiv_id.replace("/", "_")


# --- store ----------------------------------------------------------------------------------


class PaperStore:
    def __init__(self, state_dir: Path) -> None:
        self.dir = Path(state_dir) / "paper_sources"

    def _path(self, paper_id: str) -> Path:
        if not _ID_OK.match(paper_id):
            raise NotFound(f"Unknown paper {paper_id}")
        return self.dir / f"{paper_id}.json"

    def save(self, src: PaperSource) -> None:
        path = self._path(src.paper_id)
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(src.model_dump_json(indent=2), encoding="utf-8")
        tmp.replace(path)

    def load(self, paper_id: str) -> PaperSource | None:
        path = self._path(paper_id)
        if not path.exists():
            return None
        return PaperSource.model_validate_json(path.read_text(encoding="utf-8"))


# --- PDF path -------------------------------------------------------------------------------


async def ingest_pdf_bytes(
    data: bytes,
    *,
    paper_id: str | None = None,
    arxiv_id: str | None = None,
    meta: arxiv.ArxivMetadata | None = None,
) -> PaperSource:
    try:
        res = await _thread(parse_pdf, data)
    except PdfError as e:
        raise IngestError(f"Could not read PDF: {e}", status_code=422) from e
    return PaperSource(
        paper_id=paper_id or f"pdf_{sha12(data)}",
        source_kind="pdf",
        title=(meta.title if meta else "") or res.title or "Untitled PDF",
        authors=(meta.authors if meta else []) or res.authors,
        arxiv_id=arxiv_id,
        abstract=(meta.abstract if meta else "") or res.abstract,
        method_text=res.method_text,
        equations=[],  # not reliably extractable from PDF text
        macros=[],
        truncated=res.truncated,
    )


# --- arXiv path -----------------------------------------------------------------------------


async def ingest_arxiv(arxiv_id: str, client: httpx.AsyncClient) -> PaperSource:
    pid = arxiv_paper_id(arxiv_id)
    meta: arxiv.ArxivMetadata | None = None
    try:
        meta = await arxiv.fetch_metadata(arxiv_id, client)
    except AppError as e:
        log.warning("arXiv metadata for %s unavailable: %s", arxiv_id, e.message)

    try:
        payload = await arxiv.fetch_eprint(arxiv_id, client)
        if payload.startswith(b"%PDF"):  # PDF-only submission
            return await ingest_pdf_bytes(payload, paper_id=pid, arxiv_id=arxiv_id, meta=meta)
        files = await _thread(unpack_eprint, payload)
        res = await _thread(process_latex, files)
        if not res.method_text.strip():
            raise LatexError("no method text found in LaTeX source")
        return PaperSource(
            paper_id=pid,
            source_kind="arxiv_tex",
            title=(meta.title if meta else "") or res.title or arxiv_id,
            authors=meta.authors if meta else [],
            arxiv_id=arxiv_id,
            abstract=(meta.abstract if meta else "") or res.abstract,
            method_text=res.method_text,
            equations=res.equations,
            macros=res.macros,
            truncated=res.truncated,
        )
    except (AppError, LatexError, httpx.HTTPError) as e:
        log.warning("arXiv LaTeX route failed for %s (%s); falling back to PDF", arxiv_id, e)

    pdf = await arxiv.fetch_pdf(arxiv_id, client)
    return await ingest_pdf_bytes(pdf, paper_id=pid, arxiv_id=arxiv_id, meta=meta)


# --- URL path -------------------------------------------------------------------------------


def check_public_http_url(url: str) -> None:
    u = urlparse(url)
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host:
        raise IngestError("url must be an http(s) link")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise IngestError("url must point to a public host")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return
    if not ip.is_global:
        raise IngestError("url must point to a public host")


async def ingest_url(url: str, client: httpx.AsyncClient) -> PaperSource:
    aid = arxiv.parse_arxiv_id(url)
    if aid:
        return await ingest_arxiv(aid, client)
    check_public_http_url(url)
    got = await arxiv.get_capped(client, url, MAX_PDF_BYTES, non_pdf_cap=HTML_CAP_BYTES)
    pid = f"url_{sha12(url)}"
    if got.content.startswith(b"%PDF"):
        return await ingest_pdf_bytes(got.content, paper_id=pid)

    charset = re.search(r"charset=([\w\-]+)", got.content_type, re.IGNORECASE)
    try:
        html = got.content.decode(charset.group(1) if charset else "utf-8", "replace")
    except LookupError:
        html = got.content.decode("utf-8", "replace")
    title, description, text = html_to_text(html)
    if not text.strip():
        raise IngestError("page has no extractable text", status_code=422)
    method = text[:METHOD_BUDGET]
    return PaperSource(
        paper_id=pid,
        source_kind="html",
        title=title or urlparse(url).hostname or "Web page",
        authors=[],
        abstract=description or " ".join(text.split())[:800],
        method_text=method,
        equations=extract_equations(method),
        macros=[],
        truncated=got.capped or len(text) > METHOD_BUDGET,
    )


async def ingest_upload(data: bytes) -> PaperSource:
    if len(data) > MAX_PDF_BYTES:
        raise IngestError("PDF larger than 50 MB", status_code=413)
    if not data.startswith(b"%PDF"):
        raise IngestError("uploaded file is not a PDF", status_code=415)
    return await ingest_pdf_bytes(data)


def require_one_source(file_given: bool, arxiv_id: str | None, url: str | None) -> None:
    n = sum([file_given, bool(arxiv_id and arxiv_id.strip()), bool(url and url.strip())])
    if n != 1:
        raise IngestError("provide exactly one of: file (PDF), arxiv_id, url")


__all__ = [
    "IngestError",
    "PaperStore",
    "arxiv_paper_id",
    "ingest_arxiv",
    "ingest_pdf_bytes",
    "ingest_upload",
    "ingest_url",
    "require_one_source",
    "sha12",
]
