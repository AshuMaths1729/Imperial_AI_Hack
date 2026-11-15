"""HTML page -> plain text using only the stdlib parser. Content is untrusted data."""

from __future__ import annotations

from html.parser import HTMLParser

HTML_CAP_BYTES = 200 * 1024
_SKIP = {"script", "style", "noscript", "svg", "head", "template", "iframe"}
_BLOCK = {
    "p", "div", "br", "li", "ul", "ol", "tr", "table", "section", "article", "pre",
    "blockquote", "figure", "figcaption",
}  # fmt: skip
_HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


class _Extractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self.description = ""
        self._skip = 0
        self._in_title = False
        self._first_h1 = ""
        self._in_h1 = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            d = dict(attrs)
            if (d.get("name") or d.get("property") or "").lower() in (
                "description",
                "og:description",
            ):
                self.description = self.description or (d.get("content") or "")
        if tag in _SKIP and tag != "head":
            self._skip += 1
        if tag in _HEADINGS:
            self.parts.append("\n\n## ")
            self._in_h1 = tag == "h1"
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in _SKIP and tag != "head" and self._skip:
            self._skip -= 1
        if tag in _HEADINGS:
            self.parts.append("\n")
            self._in_h1 = False
        elif tag in _BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
            return
        if self._skip:
            return
        if self._in_h1 and not self._first_h1:
            self._first_h1 = data.strip()
        self.parts.append(data)

    @property
    def best_title(self) -> str:
        return " ".join((self.title or self._first_h1).split())


def html_to_text(html: str) -> tuple[str, str, str]:
    """-> (title, description, text). Never raises on malformed markup."""
    p = _Extractor()
    try:
        p.feed(html)
        p.close()
    except Exception:  # noqa: BLE001 - malformed HTML must not take the request down
        pass
    lines = [" ".join(ln.split()) for ln in "".join(p.parts).split("\n")]
    out: list[str] = []
    for ln in lines:
        if ln or (out and out[-1]):
            out.append(ln)
    return p.best_title, " ".join(p.description.split()), "\n".join(out).strip()
