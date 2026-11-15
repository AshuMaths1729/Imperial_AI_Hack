"""Paper ingestion: LaTeX unpack/resolve/select, PDF and HTML paths, arXiv fallback, endpoints.

No live network: HTTP goes through `httpx.MockTransport`; archives are built in memory.
"""

from __future__ import annotations

import gzip
import io
import tarfile

import httpx
import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.modules.paper_ingest import service
from app.modules.paper_ingest.latex import (
    UnpackError,
    expand_includes,
    find_main_tex,
    process_latex,
    strip_comments,
    unpack_eprint,
)
from app.modules.paper_ingest.router import get_http_client
from app.modules.paper_ingest.selection import extract_equations
from app.modules.paper_ingest.webpage import html_to_text
from app.settings import Settings
from app.tools.scholarly import arxiv

MAIN_TEX = r"""
\documentclass{article}
\newcommand{\R}{\mathbb{R}}
\renewcommand\vec[1]{\boldsymbol{#1}}
\def\eps{\varepsilon}
\DeclareMathOperator{\argmin}{arg\,min}
% \newcommand{\hidden}{commented out}
\title{Heavy Ball ODEs\thanks{funded}}
\begin{document}
\maketitle
\begin{abstract}
We derive an ODE limit.
\end{abstract}
\section{Introduction}
Intro text with 50\% growth. % hidden comment \input{secret}
\input{secret}
\section{Our Method}
\input{sections/method}
\section{Experiments}
Numbers and a figure.
\begin{figure}\includegraphics{x.png}\caption{A phase portrait}\end{figure}
\bibliography{refs}
\end{document}
"""

METHOD_TEX = r"""
\subsection{ODE derivation}
We take the limit of the scheme. % trailing comment
\begin{equation}\label{eq:ode}
\ddot{X} + \frac{3}{t}\dot{X} + \nabla f(X) = 0
\end{equation}
\input{details}
"""

# details includes method again -> include cycle
DETAILS_TEX = r"""
More details.
\begin{align*}
x_{k+1} &= y_k - s \nabla f(y_k)
\end{align*}
\input{sections/method}
"""

SECRET_TEX = "SECRET-CONTENT-SHOULD-NOT-APPEAR \\begin{equation} z \\end{equation}"


def targz(members: dict[str, bytes], *, extra=None) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data in members.items():
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
        if extra:
            extra(tf)
    return buf.getvalue()


def sample_archive() -> bytes:
    return targz(
        {
            "main.tex": MAIN_TEX.encode(),
            "sections/method.tex": METHOD_TEX.encode(),
            "sections/details.tex": DETAILS_TEX.encode(),
            "other.tex": b"x",
        }
    )


def make_pdf(pages: list[str]) -> bytes:
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        page.insert_text((72, 72), text, fontsize=11)
    out = doc.tobytes()
    doc.close()
    return out


ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <id>http://arxiv.org/abs/1503.01243v2</id>
  <title>A Differential Equation
  for Modeling Nesterov</title>
  <summary>  We derive a second-order ODE.  </summary>
  <author><name>Weijie Su</name></author>
  <author><name>Stephen Boyd</name></author>
 </entry>
</feed>"""


def arxiv_handler(eprint: bytes | int = b"", pdf: bytes | None = None, atom: str = ATOM):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "export.arxiv.org/api/query" in url:
            return httpx.Response(200, text=atom)
        if "/e-print/" in url:
            if isinstance(eprint, int):
                return httpx.Response(eprint)
            return httpx.Response(200, content=eprint)
        if "/pdf/" in url and pdf is not None:
            return httpx.Response(200, content=pdf, headers={"content-type": "application/pdf"})
        return httpx.Response(404)

    return handler


def mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# --- unpack ---------------------------------------------------------------------------------


def test_unpack_nested_input_cycle_and_comments():
    files = unpack_eprint(sample_archive())
    assert set(files) == {"main.tex", "sections/method.tex", "sections/details.tex", "other.tex"}
    assert find_main_tex(files) == "main.tex"
    # `\input{secret}` only appears inside a comment or is unresolvable -> never inlined
    expanded = expand_includes({**files, "secret.tex": SECRET_TEX}, "main.tex")
    assert "hidden comment" not in expanded
    assert "commented out" not in expanded
    assert r"50\% growth" in expanded  # escaped percent survives
    assert expanded.count("More details.") == 1  # cycle guard: method <-> details
    assert "x_{k+1}" in expanded
    # the (uncommented) \input{secret} on its own line is inlined; the commented one is not
    assert expanded.count("SECRET-CONTENT") == 1


def test_path_traversal_and_links_are_skipped():
    def extra(tf: tarfile.TarFile):
        for name, kind in (("link.tex", tarfile.SYMTYPE), ("hard.tex", tarfile.LNKTYPE)):
            ti = tarfile.TarInfo(name)
            ti.type = kind
            ti.linkname = "/etc/passwd" if kind == tarfile.SYMTYPE else "main.tex"
            tf.addfile(ti)

    data = targz(
        {
            "main.tex": MAIN_TEX.encode(),
            "../evil.tex": b"EVIL",
            "/abs/evil2.tex": b"EVIL",
            "a/../../evil3.tex": b"EVIL",
        },
        extra=extra,
    )
    assert list(unpack_eprint(data)) == ["main.tex"]


def test_bomb_guards():
    # declared member size beyond the total cap
    big = targz({"main.tex": b"%" * (3 * 1024 * 1024)})
    with pytest.raises(UnpackError):
        unpack_eprint(big, max_total=1024 * 1024)
    # gzip bomb: tiny compressed payload that inflates past the cap
    bomb = gzip.compress(b"\0" * (5 * 1024 * 1024))
    assert len(bomb) < 20_000
    with pytest.raises(UnpackError):
        unpack_eprint(bomb, max_total=1024 * 1024)
    # too many members
    many = targz({f"f{i}.tex": b"x" for i in range(30)})
    with pytest.raises(UnpackError):
        unpack_eprint(many, max_members=10)


def test_single_gzipped_tex_and_non_latex():
    tex = gzip.compress(MAIN_TEX.encode())
    assert list(unpack_eprint(tex)) == ["main.tex"]
    with pytest.raises(UnpackError):
        unpack_eprint(gzip.compress(b"just some words, not latex"))
    with pytest.raises(UnpackError):
        unpack_eprint(b"\x1f\x8b garbage")


# --- latex processing -----------------------------------------------------------------------


def test_process_latex_equations_macros_title():
    res = process_latex(unpack_eprint(sample_archive()))
    assert res.title == "Heavy Ball ODEs"
    assert "We derive an ODE limit." in res.abstract
    assert "ODE derivation" in res.method_text
    assert "phase portrait" in res.method_text  # figure replaced by its caption
    assert "includegraphics" not in res.method_text
    labels = {e.label for e in res.equations}
    assert "eq:ode" in labels
    ode = next(e for e in res.equations if e.label == "eq:ode")
    assert r"\ddot{X}" in ode.latex and r"\label" not in ode.latex
    assert "limit of the scheme" in ode.context
    assert any("x_{k+1}" in e.latex for e in res.equations)  # align* extracted too
    assert not res.truncated
    macros = " | ".join(res.macros)
    for needle in (r"\R", r"\vec", r"\eps", r"\argmin"):
        assert needle in macros
    assert "hidden" not in macros


def test_method_sections_win_under_budget():
    filler = "Lorem ipsum dolor sit amet. " * 400
    tex = (
        "\\documentclass{article}\\begin{document}\n"
        f"\\section{{Related Work}}\n{filler}\n"
        "\\section{Model and Derivation}\n\\begin{equation}a=b\\end{equation}\nKEEPME\n"
        f"\\section{{Acknowledgments}}\n{filler}\n"
        "\\end{document}"
    )
    res = process_latex({"main.tex": tex}, budget=2000)
    assert "KEEPME" in res.method_text
    assert "Acknowledgments" not in res.method_text
    assert res.truncated  # related work could not fit
    assert len(res.method_text) < 2600


def test_appendix_sections_yield_to_main_text():
    proofs = "\\begin{equation}a=b\\end{equation}\nPROOFSTUFF " * 120
    tex = (
        "\\documentclass{article}\\begin{document}\n"
        "\\section{Derivation}\n\\begin{equation}c=d\\end{equation}\nMAINSTUFF\n"
        f"\\appendix\n\\section{{Proof of the Theorem}}\n{proofs}\n"
        "\\end{document}"
    )
    res = process_latex({"main.tex": tex}, budget=1800)
    assert "MAINSTUFF" in res.method_text
    assert "appendix" not in res.method_text  # the bare \appendix command is stripped
    assert res.truncated


def test_strip_comments_and_equation_extraction():
    assert strip_comments("a 5\\% b % c\nd \\\\% e\nf") == "a 5\\% b \nd \\\\\nf"
    text = (
        "Preceding words before the first equation. $$E=mc^2$$ then \\[ x = y \\] and "
        "\\begin{gather}\\label{g}a=b\\end{gather} "
        "\\begin{eqnarray*}c&=&d\\end{eqnarray*}"
    )
    eqs = extract_equations(text)
    assert [e.latex for e in eqs] == ["E=mc^2", "x = y", "a=b", "c&=&d"]
    assert eqs[2].label == "g"
    assert eqs[0].context.endswith("first equation.")


# --- service: arXiv, fallback ---------------------------------------------------------------


async def test_service_arxiv_tex():
    async with mock_client(arxiv_handler(sample_archive())) as c:
        src = await service.ingest_arxiv("1503.01243", c)
    assert src.paper_id == "arxiv_1503.01243"
    assert src.source_kind == "arxiv_tex"
    assert src.title == "A Differential Equation for Modeling Nesterov"  # metadata wins
    assert src.authors == ["Weijie Su", "Stephen Boyd"]
    assert src.abstract == "We derive a second-order ODE."
    assert any(r"\ddot{X}" in e.latex for e in src.equations)


async def test_service_pdf_only_eprint_uses_pdf_route():
    pdf = make_pdf(["Some Title\nPlain body text about models."])
    async with mock_client(arxiv_handler(pdf)) as c:
        src = await service.ingest_arxiv("1503.01243", c)
    assert src.source_kind == "pdf"
    assert src.arxiv_id == "1503.01243"
    assert src.equations == []
    assert "body text" in src.method_text
    assert src.title.startswith("A Differential Equation")


@pytest.mark.parametrize("eprint", [500, b"not an archive at all", gzip.compress(b"nope")])
async def test_service_falls_back_to_pdf_on_failure(eprint):
    pdf = make_pdf(["Fallback paper\nThe model is described here."])
    async with mock_client(arxiv_handler(eprint, pdf=pdf)) as c:
        src = await service.ingest_arxiv("1503.01243", c)
    assert src.source_kind == "pdf" and "model is described" in src.method_text


async def test_service_fails_when_everything_fails():
    from app.core.errors import UpstreamError

    async with mock_client(arxiv_handler(500, pdf=None)) as c:
        with pytest.raises(UpstreamError):
            await service.ingest_arxiv("1503.01243", c)


def test_parse_arxiv_id_variants():
    p = arxiv.parse_arxiv_id
    assert p("1503.01243") == "1503.01243"
    assert p("arXiv:1503.01243v2") == "1503.01243v2"
    assert p("https://arxiv.org/abs/1503.01243") == "1503.01243"
    assert p("https://arxiv.org/pdf/1503.01243v1.pdf") == "1503.01243v1"
    assert p("hep-th/9901001") == "hep-th/9901001"
    assert p("https://example.com/abs/1503.01243") is None
    assert p("not an id") is None
    assert p("") is None


def test_pdf_sections_and_html_text():
    body = "\n".join(
        [
            "Big Paper Title",
            "Abstract",
            "We study things in great detail for many many words here " * 4,
            "1 Introduction",
            "Intro words.",
            "2 Model and Dynamics",
            "KEEP the dx/dt = f(x) model.",
            "3 Experiments",
            "Experiment words.",
            "References",
            "[1] Somebody.",
        ]
    )
    from app.modules.paper_ingest.pdf import parse_pdf

    res = parse_pdf(make_pdf([body]))
    assert "KEEP the dx/dt" in res.method_text
    assert "[1] Somebody" not in res.method_text  # references excluded
    assert res.title

    title, desc, text = html_to_text(
        "<html><head><title> My  Page </title><meta name='description' content='D'>"
        "<script>evil()</script></head><body><h1>H</h1><p>Hello <b>world</b></p>"
        "<style>x{}</style></body></html>"
    )
    assert title == "My Page" and desc == "D"
    assert "evil" not in text and "Hello world" in text and "## H" in text


# --- endpoints ------------------------------------------------------------------------------


@pytest.fixture
def api(tmp_path):
    settings = Settings(_env_file=None, state_dir=tmp_path / "state")
    app = create_app(settings)
    handler_box = {"h": arxiv_handler(sample_archive())}

    def handler(request):
        return handler_box["h"](request)

    app.dependency_overrides[get_http_client] = lambda: mock_client(handler)
    with TestClient(app) as c:
        c.handler_box = handler_box  # type: ignore[attr-defined]
        c.settings = settings  # type: ignore[attr-defined]
        yield c


def test_endpoint_arxiv_roundtrip_and_cache(api):
    r = api.post("/api/ingest/paper", data={"arxiv_id": "arXiv:1503.01243"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["paper_id"] == "arxiv_1503.01243"
    assert body["source_kind"] == "arxiv_tex"
    assert body["arxiv_id"] == "1503.01243"
    assert set(body) >= {"equations", "macros", "truncated", "method_text", "abstract", "authors"}
    got = api.get("/api/ingest/paper/arxiv_1503.01243")
    assert got.status_code == 200 and got.json() == body
    assert (api.settings.state_dir / "paper_sources" / "arxiv_1503.01243.json").exists()
    # second call is served from the store even if upstream is now broken
    api.handler_box["h"] = arxiv_handler(500)
    assert api.post("/api/ingest/paper", data={"arxiv_id": "1503.01243"}).json() == body


def test_endpoint_url_variants(api):
    r = api.post("/api/ingest/paper", data={"url": "https://arxiv.org/abs/1503.01243v2"})
    assert r.status_code == 200 and r.json()["paper_id"] == "arxiv_1503.01243v2"

    pdf = make_pdf(["Direct PDF\nThe model."])

    def pages(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith(".pdf"):
            return httpx.Response(200, content=pdf, headers={"content-type": "application/pdf"})
        return httpx.Response(
            200,
            text="<html><title>Blog</title><body><p>Our method: $$x=1$$</p></body></html>",
            headers={"content-type": "text/html; charset=utf-8"},
        )

    api.handler_box["h"] = pages
    r = api.post("/api/ingest/paper", data={"url": "https://example.org/files/p.pdf"})
    assert r.status_code == 200
    assert r.json()["source_kind"] == "pdf" and r.json()["paper_id"].startswith("url_")
    r = api.post("/api/ingest/paper", data={"url": "https://example.org/post"})
    assert r.status_code == 200
    j = r.json()
    assert j["source_kind"] == "html" and j["title"] == "Blog"
    assert [e["latex"] for e in j["equations"]] == ["x=1"]


def test_endpoint_pdf_upload(api):
    pdf = make_pdf(["Uploaded\nThe method section."])
    r = api.post("/api/ingest/paper", files={"file": ("p.pdf", pdf, "application/pdf")})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["source_kind"] == "pdf" and j["paper_id"] == f"pdf_{service.sha12(pdf)}"
    assert api.get(f"/api/ingest/paper/{j['paper_id']}").json() == j
    bad = api.post("/api/ingest/paper", files={"file": ("p.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 415


def test_endpoint_errors(api):
    assert api.post("/api/ingest/paper").status_code == 400
    two = api.post("/api/ingest/paper", data={"arxiv_id": "1503.01243", "url": "https://x.org/a"})
    assert two.status_code == 400
    assert api.post("/api/ingest/paper", data={"arxiv_id": "nonsense"}).status_code == 400
    for bad_url in ("http://localhost:8000/x", "http://127.0.0.1/x", "ftp://example.org/x"):
        assert api.post("/api/ingest/paper", data={"url": bad_url}).status_code == 400
    assert api.get("/api/ingest/paper/arxiv_0000.00000").status_code == 404
    assert api.get("/api/ingest/paper/..%2F..%2Fsecret").status_code == 404
    body = api.post("/api/ingest/paper").json()
    assert body["error"]["code"] == "ingest_bad_request"


def test_endpoint_offline_cache_miss(tmp_path):
    settings = Settings(_env_file=None, state_dir=tmp_path / "s", cache_mode="offline")
    app = create_app(settings)
    with TestClient(app) as c:
        r = c.post("/api/ingest/paper", data={"arxiv_id": "1503.01243"})
    assert r.status_code == 503


# --- live (excluded from the default run) -----------------------------------------------------


@pytest.mark.live
async def test_live_nesterov_ode_paper():
    async with httpx.AsyncClient(
        timeout=30, follow_redirects=True, headers={"User-Agent": arxiv.USER_AGENT}
    ) as c:
        src = await service.ingest_arxiv("1503.01243", c)
    print(
        f"\nsource_kind={src.source_kind} title={src.title!r} equations={len(src.equations)} "
        f"has_ddot={'ddot' in src.method_text} method_text_len={len(src.method_text)} "
        f"truncated={src.truncated} macros={len(src.macros)}"
    )
    assert src.source_kind == "arxiv_tex"
    assert src.equations and "ddot" in src.method_text
