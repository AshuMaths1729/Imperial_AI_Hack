"""Maths to speech (v3.2 G5). ElevenLabs garbles symbols ("(3, 9)" mumbled, "PQ" -> "P U two into", "m/s" -> "mils",
"0.001" -> "0.01"); the same sentences in words are spoken cleanly. speak_maths() rewrites a piece of text into
words; MathsSpeech does it on a stream, holding text back only until a safe cut (after a plain word, outside
brackets), so no maths token is split across chunks."""

import re

ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
        "seventeen eighteen nineteen").split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
SCALES = ((10**9, "billion"), (10**6, "million"), (1000, "thousand"))
ORDINAL = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth",
           "twelve": "twelfth"}
GREEK = {"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "Δ": "delta", "ε": "epsilon", "ζ": "zeta",
         "η": "eta", "θ": "theta", "λ": "lambda", "μ": "mu", "π": "pi", "ρ": "rho", "σ": "sigma", "Σ": "sigma",
         "τ": "tau", "φ": "phi", "ω": "omega", "∇": "del", "∂": "partial"}
SUPERSCRIPT = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻ⁿ", "0123456789-n")
UNITS = {  # (one, many)
    "km/h": ("kilometre per hour", "kilometres per hour"), "m/s²": ("metre per second squared", "metres per second squared"),
    "m/s^2": ("metre per second squared", "metres per second squared"), "m/s": ("metre per second", "metres per second"),
    "km": ("kilometre", "kilometres"), "cm": ("centimetre", "centimetres"), "mm": ("millimetre", "millimetres"),
    "kg": ("kilogram", "kilograms"), "m": ("metre", "metres"), "s": ("second", "seconds"),
}
SYMBOLS = [  # order matters: two-character forms first
    ("->", " tends to "), ("<=", " is less than or equal to "), (">=", " is greater than or equal to "),
    ("→", " tends to "), ("≈", " is about "), ("≠", " is not equal to "), ("≤", " is less than or equal to "),
    ("≥", " is greater than or equal to "), ("×", " times "), ("·", " times "), ("÷", " divided by "),
    ("±", " plus or minus "), ("=", " equals "), ("+", " plus "), ("<", " is less than "), (">", " is greater than "),
    ("−", " minus "), ("√", " root "), ("∞", " infinity "), ("%", " percent"), ("°", " degrees"),
]

NUM = r"\d+(?:\.\d+)?"
_OPERAND = rf"-?{NUM}(?:/\d+)?|-?[A-Za-z]"
_COORDS = re.compile(rf"\(\s*(?:{_OPERAND})(?:\s*,\s*(?:{_OPERAND}))+\s*\)")
_FRACTION = re.compile(rf"(?<![\w/])({NUM}|[A-Za-z]|squared|cubed|\([^()]*\))\s*/\s*({NUM}|[A-Za-z]|\([^()]*\))(?![\w/])")
_UNIT_AFTER_NUMBER = re.compile(rf"(?<![\w.])({NUM})\s?(km/h|m/s(?:²|\^2)?|km|cm|mm|kg|m|s)(?![\w/^²])")
_UNIT_ALONE = re.compile(r"(?<![\w/])(km/h|m/s(?:²|\^2)?)(?![\w/])")
_SAFE_CUT = re.compile(r"[A-Za-z]{2,}[,.;:!?'\")]*\s")  # a plain word ending at whitespace: no maths spans it


def int_words(n: int) -> str:
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + (f" {ONES[n % 10]}" if n % 10 else "")
    if n < 1000:
        return f"{ONES[n // 100]} hundred" + (f" {int_words(n % 100)}" if n % 100 else "")
    for scale, name in SCALES:
        if n >= scale:
            return f"{int_words(n // scale)} {name}" + (f" {int_words(n % scale)}" if n % scale else "")
    raise AssertionError(n)


def number_words(whole: str, frac: str | None) -> str:
    """Integers in words (digit by digit if they have a leading zero or are huge); decimals digit by digit."""
    if (len(whole) > 1 and whole[0] == "0") or len(whole) > 12:
        out = " ".join(ONES[int(d)] for d in whole)
    else:
        out = int_words(int(whole))
    return out + (" point " + " ".join(ONES[int(d)] for d in frac) if frac else "")


def _ordinal(m: re.Match) -> str:
    *head, last = int_words(int(m[1])).split()
    last = ORDINAL.get(last) or (last[:-1] + "ieth" if last.endswith("y") else last + "th")
    return " ".join([*head, last])


def _unit(m: re.Match) -> str:
    one, many = UNITS[m[2]]
    return f"{m[1]} {one if m[1] == '1' else many}"


def _coords(text: str) -> str:
    def sub(m: re.Match) -> str:
        inner = ", ".join(p.strip() for p in m[0][1:-1].split(","))
        return f" at {inner}" if m.start() and text[m.start() - 1].isupper() else inner  # "P(1, 1)" -> "P at 1, 1"
    return _COORDS.sub(sub, text)


def _power(m: re.Match) -> str:
    p = m[1].translate(SUPERSCRIPT)
    return {"2": " squared ", "3": " cubed "}.get(p, f" to the power {p} ")


def speak_maths(text: str) -> str:
    """Rewrite maths in `text` as the words a teacher would say. Leading/trailing whitespace is kept."""
    core = text.strip()
    if not core:
        return text
    lead, trail = text[: len(text) - len(text.lstrip())], text[len(text.rstrip()):]
    t = core
    t = re.sub(r"\bd²([A-Za-z])/d([A-Za-z])²", r"d two \1 by d \2 squared", t)
    t = re.sub(r"\bd([A-Za-z])/d([A-Za-z])\b", r"d \1 by d \2", t)
    t = re.sub(r"\bd/d([A-Za-z])\b", r"d by d \1", t)
    t = _UNIT_AFTER_NUMBER.sub(_unit, t)
    t = _UNIT_ALONE.sub(lambda m: UNITS[m[1]][1], t)
    t = re.sub("|".join(GREEK), lambda m: GREEK[m[0]] + " ", re.sub(f"(?<=\\w)([{''.join(GREEK)}])", r" \1", t))
    # f(x), L(θ) -> "f of x" (a comma inside makes it a point instead)
    t = re.sub(r"\b([A-Za-z])(')?\(([^(),]{1,15})\)", lambda m: f"{m[1]}{' prime' if m[2] else ''} of {m[3].strip()}", t)
    t = _coords(t)
    t = re.sub(r"(?<![\d,])(\d{1,3}(?:,\d{3})+)(?![\d,])", lambda m: m[1].replace(",", ""), t)
    t = re.sub(r"\^\{([^{}]*)\}|\^\(([^()]*)\)", lambda m: f" to the power {m[1] or m[2]} ", t)
    t = re.sub(r"\^(-?\w+)", _power, t)
    t = re.sub(r"([⁰¹²³⁴⁵⁶⁷⁸⁹⁻ⁿ]+)", _power, t)
    t = _FRACTION.sub(r"\1 over \2", t)
    for sym, words in SYMBOLS:
        t = t.replace(sym, words)
    t = re.sub(r"(?<=[\w)])\s*\*\s*(?=[\w(])", " times ", t)
    t = re.sub(r"(^|\s)-\s(?=[\d(]|[A-Za-z](?![A-Za-z]))", r"\1minus ", t)  # "x - 3", not "this - that"
    t = re.sub(r"(?<![A-Za-z])(\d+(?:\.\d+)?|[A-Za-z]|\))-(?=[\d(]|[A-Za-z](?![A-Za-z]))", r"\1 minus ", t)  # x-3
    t = re.sub(r"(^|[\s(=,])-(?=[\w(.])", r"\1minus ", t)  # -3, -x
    t = re.sub(r"\b(?!OK\b)([A-Z]{2,3})\b", lambda m: " ".join(m[1]), t)  # point names: PQ -> P Q
    t = re.sub(r"\b(\d+)(st|nd|rd|th)\b", _ordinal, t)
    t = re.sub(r"(\d)([A-Za-z])", r"\1 \2", t)  # 2x -> 2 x
    t = re.sub(r"\b([a-z])(\d)\b", r"\1 \2", t)  # y2 -> y 2
    t = re.sub(r"(?<![A-Za-z\d.])(\d+)(?:\.(\d+))?(?!\d)", lambda m: number_words(m[1], m[2]), t)
    t = re.sub(r" {2,}", " ", t)
    t = re.sub(r" +([,.;:!?)])", r"\1", t).strip()
    return lead + t + trail


class MathsSpeech:
    """Streaming speak_maths: feed() chunks, then flush(). Text is held back only up to the last safe cut."""

    LIMIT = 200  # never hold more than this: cut at the last space instead (a long run of symbols)

    def __init__(self):
        self.buf = ""
        self._space = True  # the last emitted character was whitespace (or nothing was emitted yet)

    def _cut(self) -> int:
        cut = 0
        for m in _SAFE_CUT.finditer(self.buf):
            if self.buf.count("(", 0, m.end()) <= self.buf.count(")", 0, m.end()):
                cut = m.end()
        if not cut and len(self.buf) > self.LIMIT:
            cut = self.buf.rfind(" ") + 1
        return cut

    def _emit(self, text: str) -> str:
        out = speak_maths(text)
        if self._space:
            out = out.lstrip(" ")
        if out:
            self._space = out[-1].isspace()
        return out

    def feed(self, chunk: str) -> str:
        self.buf += chunk
        cut = self._cut()
        if not cut:
            return ""
        text, self.buf = self.buf[:cut], self.buf[cut:]
        return self._emit(text)

    def flush(self) -> str:
        text, self.buf = self.buf, ""
        return self._emit(text) if text else ""
