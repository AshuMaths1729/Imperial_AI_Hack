"""arXiv LaTeX source -> method text + equations. Pure functions, no IO, no LLM.

`unpack_eprint` is a safe in-memory unpacker (never touches disk, never follows links)."""

from __future__ import annotations

import io
import posixpath
import re
import tarfile
import zlib
from dataclasses import dataclass, field

from app.modules.paper_ingest.models import Equation
from app.modules.paper_ingest.selection import (
    METHOD_BUDGET,
    Chunk,
    count_display_math,
    extract_equations,
    select_sections,
)

MAX_TOTAL_BYTES = 50 * 1024 * 1024
MAX_MEMBERS = 2000
MAX_DEPTH = 10
MAX_EXPANDED_CHARS = 20_000_000


class LatexError(Exception):
    pass


class UnpackError(LatexError):
    pass


@dataclass
class LatexResult:
    title: str = ""
    abstract: str = ""
    method_text: str = ""
    equations: list[Equation] = field(default_factory=list)
    macros: list[str] = field(default_factory=list)
    truncated: bool = False


# --- unpacking ----------------------------------------------------------------------------


def _safe_name(name: str) -> str | None:
    n = name.replace("\\", "/")
    if n.startswith("/") or re.match(r"^[A-Za-z]:", n):
        return None
    parts = [p for p in n.split("/") if p not in ("", ".")]
    if not parts or ".." in parts:
        return None
    return "/".join(parts)


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def unpack_eprint(
    data: bytes, *, max_total: int = MAX_TOTAL_BYTES, max_members: int = MAX_MEMBERS
) -> dict[str, str]:
    """gzip(tar) | gzip(single .tex) | tar | plain .tex -> {relative path: text} of .tex files.

    Skips symlinks/hardlinks/devices and absolute or `..` member names; raises `UnpackError`
    when a cap (total bytes / member count) is exceeded or the payload is not LaTeX."""
    raw = data
    if data[:2] == b"\x1f\x8b":
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
        try:
            raw = d.decompress(data, max_total + 1)
        except zlib.error as e:
            raise UnpackError(f"bad gzip payload: {e}") from e
        if len(raw) > max_total or d.unconsumed_tail:
            raise UnpackError("decompressed payload exceeds the size cap")
    elif len(raw) > max_total:
        raise UnpackError("payload exceeds the size cap")

    try:
        tf = tarfile.open(fileobj=io.BytesIO(raw), mode="r:")
    except tarfile.TarError:
        text = _decode(raw)
        if "\\begin{document}" not in text and "\\documentclass" not in text:
            raise UnpackError("payload is neither a tar archive nor a LaTeX file") from None
        return {"main.tex": text}

    files: dict[str, str] = {}
    total = count = 0
    try:
        with tf:
            for m in tf:
                count += 1
                if count > max_members:
                    raise UnpackError(f"archive has more than {max_members} members")
                if not m.isreg():  # symlinks, hardlinks, devices, directories
                    continue
                name = _safe_name(m.name)
                if name is None:
                    continue
                total += m.size
                if total > max_total or m.size > max_total:
                    raise UnpackError("archive contents exceed the size cap")
                if not name.lower().endswith((".tex", ".ltx")):
                    continue
                f = tf.extractfile(m)
                if f is not None:
                    files[name] = _decode(f.read(m.size))
    except tarfile.TarError as e:
        raise UnpackError(f"corrupt tar archive: {e}") from e
    if not files:
        raise UnpackError("archive contains no .tex files")
    return files


# --- text helpers -------------------------------------------------------------------------

_COMMENT = re.compile(r"(?<!\\)((?:\\\\)*)%[^\n]*")
_COMMENT_ENV = re.compile(r"\\begin\{comment\}.*?\\end\{comment\}", re.DOTALL)


def strip_comments(text: str) -> str:
    r"""Remove `%` comments but keep `\%` (while `\\%` *is* a comment, as in TeX)."""
    return _COMMENT.sub(r"\1", _COMMENT_ENV.sub("", text))


def balanced(s: str, i: int) -> int:
    """Index just past the `}` matching the `{` at s[i], or -1."""
    depth = 0
    j, n = i, len(s)
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return -1


def _plain(s: str) -> str:
    while True:  # drop \thanks{...} / \footnote{...}
        m = re.search(r"\\(?:thanks|footnote)\s*\{", s)
        if not m:
            break
        end = balanced(s, m.end() - 1)
        s = s[: m.start()] + (s[end:] if end > 0 else "")
    s = s.replace("\\\\", " ")
    s = re.sub(r"\\[a-zA-Z]+\*?", "", s)
    s = re.sub(r"[{}]", "", s)
    return " ".join(s.split())


# --- main file + include resolution ------------------------------------------------------


def find_main_tex(files: dict[str, str]) -> str:
    full = [n for n, t in files.items() if "\\documentclass" in t and "\\begin{document}" in t]
    pool = full or [n for n, t in files.items() if "\\begin{document}" in t] or list(files)
    for pref in ("main.tex", "ms.tex", "paper.tex"):
        for n in pool:
            if posixpath.basename(n).lower() == pref:
                return n
    return max(pool, key=lambda n: len(files[n]))


_INCLUDE = re.compile(r"\\(?:input|include|subfile)\s*\{([^{}]+)\}")


def _resolve(files: dict[str, str], ref: str, base_dir: str) -> str | None:
    ref = ref.strip().replace("\\", "/")
    for d in (base_dir, ""):
        p = posixpath.normpath(posixpath.join(d, ref))
        for cand in (p, p + ".tex"):
            if cand in files:
                return cand
    base = posixpath.basename(ref)
    for name in files:
        if posixpath.basename(name) in (base, base + ".tex"):
            return name
    return None


def expand_includes(
    files: dict[str, str],
    main: str,
    *,
    max_depth: int = MAX_DEPTH,
    max_chars: int = MAX_EXPANDED_CHARS,
) -> str:
    """Comment-stripped main file with `\\input/\\include/\\subfile` inlined recursively
    (depth-limited, cycle-guarded, total-size-guarded)."""
    budget = [max_chars]

    def rec(name: str, depth: int, stack: frozenset[str]) -> str:
        text = strip_comments(files[name])
        out: list[str] = []
        pos = 0
        for m in _INCLUDE.finditer(text):
            out.append(text[pos : m.start()])
            pos = m.end()
            if budget[0] <= 0 or depth >= max_depth:
                continue
            target = _resolve(files, m.group(1), posixpath.dirname(name))
            if target is None or target in stack:
                continue
            out.append(rec(target, depth + 1, stack | {target}))
        out.append(text[pos:])
        s = "".join(out)
        budget[0] -= len(s)
        return s

    return rec(main, 0, frozenset({main}))


# --- macros, title, abstract --------------------------------------------------------------

_MACRO_HEADS = [
    re.compile(
        r"\\(?:re|provide)?newcommand\*?\s*(?:\{\s*\\[A-Za-z@]+\s*\}|\\[A-Za-z@]+|\\.)"
        r"\s*(?:\[\d\])?\s*(?:\[[^\]]*\])?\s*(?=\{)"
    ),
    re.compile(r"\\DeclareMathOperator\*?\s*\{?\s*\\[A-Za-z]+\s*\}?\s*(?=\{)"),
    re.compile(r"\\def\s*\\[A-Za-z@]+\s*(?:#\d)*\s*(?=\{)"),
]


def extract_macros(preamble: str, *, limit: int = 200) -> list[str]:
    found: list[tuple[int, str]] = []
    for rx in _MACRO_HEADS:
        for m in rx.finditer(preamble):
            end = balanced(preamble, m.end())
            if end > 0 and end - m.start() <= 600:
                found.append((m.start(), " ".join(preamble[m.start() : end].split())))
    return [s for _, s in sorted(found)][:limit]


def parse_title(text: str) -> str:
    m = re.search(r"\\title\s*(?:\[[^\]]*\])?\s*\{", text)
    if not m:
        return ""
    end = balanced(text, m.end() - 1)
    return _plain(text[m.end() : end - 1]) if end > 0 else ""


_ABSTRACT = re.compile(r"\\begin\{abstract\}(.*?)\\end\{abstract\}", re.DOTALL)


def parse_abstract(text: str) -> str:
    m = _ABSTRACT.search(text)
    return " ".join(m.group(1).split())[:3000] if m else ""


# --- body cleanup, sections ---------------------------------------------------------------

_ENV_DROP = re.compile(
    r"\\begin\{(figure\*?|table\*?|tikzpicture|thebibliography|wrapfigure)\}(.*?)\\end\{\1\}",
    re.DOTALL,
)
_NOISE = re.compile(
    r"\\(?:bibliography|bibliographystyle|maketitle|tableofcontents|newpage|clearpage)"
    r"(?:\s*\{[^{}]*\})?"
)
_SECTION = re.compile(r"\\(section|subsection|subsubsection)(\*?)\s*(?:\[[^\]]*\])?\s*\{")


def _drop_env(m: re.Match[str]) -> str:
    env, inner = m.group(1), m.group(2)
    if env.startswith("thebibliography"):
        return ""
    cm = re.search(r"\\caption\s*(?:\[[^\]]*\])?\s*\{", inner)
    if cm:
        end = balanced(inner, cm.end() - 1)
        if end > 0:
            return f"[{env.rstrip('*')}: {' '.join(inner[cm.end() : end - 1].split())}]"
    return ""


def clean_body(body: str) -> str:
    body = _ABSTRACT.sub("", body)
    body = _ENV_DROP.sub(_drop_env, body)
    return _NOISE.sub("", body)


def build_chunks(body: str) -> list[Chunk]:
    heads: list[tuple[int, int, str]] = []  # (start, level, title)
    for m in _SECTION.finditer(body):
        end = balanced(body, m.end() - 1)
        title = _plain(body[m.end() : end - 1]) if end > 0 else ""
        heads.append((m.start(), {"section": 1, "subsection": 2}.get(m.group(1), 3), title))
    if not heads:
        text = body.strip()
        return [Chunk("document", text, math=count_display_math(text))]
    chunks: list[Chunk] = []
    parent = ""
    app_pos = body.find("\\appendix")
    for k, (start, level, title) in enumerate(heads):
        stop = heads[k + 1][0] if k + 1 < len(heads) else len(body)
        text = body[start:stop].replace("\\appendix", "").strip()
        if level == 1:
            parent = title
        chunks.append(
            Chunk(
                title,
                text,
                parent=parent if level > 1 else "",
                math=count_display_math(text),
                appendix=0 <= app_pos <= start,
            )
        )
    return chunks


def process_latex(files: dict[str, str], *, budget: int = METHOD_BUDGET) -> LatexResult:
    main = find_main_tex(files)
    text = expand_includes(files, main)
    b = text.find("\\begin{document}")
    preamble = text[:b] if b >= 0 else ""
    body = text[b + len("\\begin{document}") :] if b >= 0 else text
    e = body.rfind("\\end{document}")
    if e >= 0:
        body = body[:e]
    method, truncated = select_sections(build_chunks(clean_body(body)), budget)
    return LatexResult(
        title=parse_title(text),
        abstract=parse_abstract(text),
        method_text=method,
        equations=extract_equations(method),
        macros=extract_macros(preamble),
        truncated=truncated,
    )
