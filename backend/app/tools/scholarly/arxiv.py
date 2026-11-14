"""arXiv helpers: id parsing, Atom metadata, e-print (LaTeX source) and PDF download.

All HTTP goes through an injected `httpx.AsyncClient` (tests pass one built on a
`MockTransport`). Everything fetched is untrusted data: it is parsed, never executed.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from urllib.parse import quote, urlparse

import httpx

from app.core.errors import NotFound, UpstreamError

USER_AGENT = "ScholarTwin-hackathon/0.2 (paper ingestion for simulation; research prototype)"
API_URL = "http://export.arxiv.org/api/query"
EPRINT_URL = "https://arxiv.org/e-print/{id}"
PDF_URL = "https://arxiv.org/pdf/{id}"
TIMEOUT_S = 30.0
MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
ARXIV_HOSTS = {"arxiv.org", "www.arxiv.org", "export.arxiv.org"}

_NEW_ID = r"\d{4}\.\d{4,5}"
_OLD_ID = r"[a-z\-]+(?:\.[A-Za-z]{2})?/\d{7}"
_ID_RE = re.compile(rf"(?:{_NEW_ID}|{_OLD_ID})(?:v\d+)?", re.IGNORECASE)


@dataclass
class ArxivMetadata:
    arxiv_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    abstract: str = ""


@dataclass
class Fetched:
    content: bytes
    content_type: str
    url: str
    capped: bool = False


def parse_arxiv_id(text: str) -> str | None:
    """`1503.01243`, `arXiv:1503.01243v2`, `hep-th/9901001`, abs/pdf/html URLs -> id (or None)."""
    s = (text or "").strip()
    if not s:
        return None
    if re.match(r"^https?://", s, re.IGNORECASE):
        u = urlparse(s)
        if (u.hostname or "").lower() not in ARXIV_HOSTS:
            return None
        m = re.match(r"^/(?:abs|pdf|html|e-print|format)/(.+?)(?:\.pdf)?/?$", u.path)
        if not m:
            return None
        s = m.group(1)
    s = re.sub(r"^arxiv\s*:\s*", "", s, flags=re.IGNORECASE)
    return s if _ID_RE.fullmatch(s) else None


def is_arxiv_host(url: str) -> bool:
    return (urlparse(url).hostname or "").lower() in ARXIV_HOSTS


async def get_capped(
    client: httpx.AsyncClient,
    url: str,
    max_bytes: int,
    *,
    non_pdf_cap: int | None = None,
) -> Fetched:
    """GET with redirects, streaming, and a size cap. If `non_pdf_cap` is set, a response that
    is not a PDF is silently cut at that many bytes (`capped=True`) instead of failing."""
    try:
        async with client.stream(
            "GET", url, headers={"User-Agent": USER_AGENT}, follow_redirects=True
        ) as r:
            if r.status_code != 200:
                raise UpstreamError(f"GET {url} -> HTTP {r.status_code}")
            ctype = r.headers.get("content-type", "")
            buf = bytearray()
            capped = False
            async for chunk in r.aiter_bytes():
                buf += chunk
                soft = (
                    non_pdf_cap is not None
                    and len(buf) >= 4
                    and not buf.startswith(b"%PDF")
                    and "pdf" not in ctype.lower()
                )
                cap = non_pdf_cap if soft and non_pdf_cap is not None else max_bytes
                if len(buf) > cap:
                    if soft:
                        del buf[cap:]
                        capped = True
                        break
                    raise UpstreamError(f"GET {url}: response larger than {max_bytes} bytes")
            return Fetched(bytes(buf), ctype, str(r.url), capped)
    except httpx.HTTPError as e:
        raise UpstreamError(f"GET {url} failed: {e.__class__.__name__}: {e}") from e


async def fetch_metadata(arxiv_id: str, client: httpx.AsyncClient) -> ArxivMetadata:
    got = await get_capped(client, f"{API_URL}?id_list={quote(arxiv_id)}", 2 * 1024 * 1024)
    xml = got.content.decode("utf-8", "replace")
    if "<!DOCTYPE" in xml or "<!ENTITY" in xml:  # no entity tricks from untrusted XML
        raise UpstreamError("arXiv metadata response rejected (DTD)")
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise UpstreamError(f"arXiv metadata is not valid XML: {e}") from e
    ns = {"a": "http://www.w3.org/2005/Atom"}
    entry = root.find("a:entry", ns)
    if entry is None or "/api/errors" in (entry.findtext("a:id", "", ns) or ""):
        raise NotFound(f"arXiv id {arxiv_id} not found")

    def clean(s: str | None) -> str:
        return " ".join((s or "").split())

    authors = [clean(a.findtext("a:name", "", ns)) for a in entry.findall("a:author", ns)]
    return ArxivMetadata(
        arxiv_id=arxiv_id,
        title=clean(entry.findtext("a:title", "", ns)),
        authors=[a for a in authors if a],
        abstract=clean(entry.findtext("a:summary", "", ns)),
    )


async def fetch_eprint(arxiv_id: str, client: httpx.AsyncClient) -> bytes:
    """Raw e-print payload: gzip(tar), gzip(single .tex), or a bare PDF. Caller sniffs it."""
    got = await get_capped(client, EPRINT_URL.format(id=arxiv_id), MAX_DOWNLOAD_BYTES)
    return got.content


async def fetch_pdf(arxiv_id: str, client: httpx.AsyncClient) -> bytes:
    got = await get_capped(client, PDF_URL.format(id=arxiv_id), MAX_DOWNLOAD_BYTES)
    if not got.content.startswith(b"%PDF"):
        raise UpstreamError(f"arXiv PDF for {arxiv_id} is not a PDF")
    return got.content
