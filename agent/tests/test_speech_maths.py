import pytest

from speech_maths import MathsSpeech, speak_maths
from speech_cues import TagStripper


@pytest.mark.parametrize("text, spoken", [
    # measured TTS->STT failures (ElevenLabs flash) and the wording that transcribed perfectly
    ("Q is at (3, 9), so the chord PQ has gradient 8/2 = 4.",
     "Q is at three, nine, so the chord P Q has gradient eight over two equals four."),
    ("dy/dx = 2x, so at x = 3 it is 6 m/s.",
     "d y by d x equals two x, so at x equals three it is six metres per second."),
    ("a step of 0.001", "a step of zero point zero zero one"),
    # decimals digit by digit, integers in words
    ("3.14", "three point one four"), ("0.5", "zero point five"), ("21", "twenty one"),
    ("1,250", "one thousand two hundred fifty"), ("105", "one hundred five"), ("1000000", "one million"),
    ("2.", "two."),
    # coordinates
    ("P(1, 1) and (-2, 4.5)", "P at one, one and minus two, four point five"),
    # fractions and operators
    ("1/2", "one over two"), ("x/2", "x over two"), ("and/or", "and/or"),
    ("3 + 4 − 1 × 2 ÷ 5 ≈ 1", "three plus four minus one times two divided by five is about one"),
    ("x - 3", "x minus three"), ("x-3", "x minus three"), ("-3", "minus three"), ("well-known", "well-known"),
    ("y ≠ 0, x ≤ 2, x ≥ 1, a < b, a > b", "y is not equal to zero, x is less than or equal to two, x is greater than "
     "or equal to one, a is less than b, a is greater than b"),
    ("2*3", "two times three"), ("±1", "plus or minus one"), ("50%", "fifty percent"), ("30°", "thirty degrees"),
    # powers
    ("x² + x³", "x squared plus x cubed"), ("x^2", "x squared"), ("x^3", "x cubed"),
    ("x^n", "x to the power n"), ("e^{-x}", "e to the power minus x"), ("2^10", "two to the power ten"),
    ("x⁴", "x to the power four"), ("3x^2", "three x squared"),
    # calculus, limits, functions
    ("d/dx", "d by d x"), ("df/dx", "d f by d x"), ("h → 0", "h tends to zero"), ("h -> 0", "h tends to zero"),
    ("f(x) = x^2", "f of x equals x squared"),
    # units
    ("9.8 m/s²", "nine point eight metres per second squared"), ("9.8 m/s^2", "nine point eight metres per second squared"),
    ("60 km/h", "sixty kilometres per hour"), ("5 m", "five metres"), ("1 m", "one metre"), ("3 s", "three seconds"),
    ("2 km", "two kilometres"), ("the gradient m", "the gradient m"),
    # point names, Greek
    ("triangle ABC and line AB", "triangle A B C and line A B"), ("OK, I see", "OK, I see"),
    ("θ, η, Δx, π", "theta, eta, delta x, pi"),
    ("the 2nd and 3rd points", "the second and third points"),
    ("plain words stay as they are.", "plain words stay as they are."),
])
def test_speak_maths(text, spoken):
    assert speak_maths(text) == spoken


def stream(*chunks):
    m = MathsSpeech()
    outs = [m.feed(c) for c in chunks] + [m.flush()]
    return outs


@pytest.mark.parametrize("chunks", [
    ["Q is at (3", ", 9", "), so the chord P", "Q has gradient 8/", "2 = 4."],
    ["dy", "/d", "x = 2", "x, so at x = 3 it is 6 m", "/s."],
    ["a step of 0.", "00", "1"],
    [c for c in "Q is at (3, 9), so the chord PQ has gradient 8/2 = 4."],  # one character at a time
])
def test_streaming_matches_the_whole_text(chunks):
    whole = "".join(chunks)
    assert " ".join("".join(stream(*chunks)).split()) == speak_maths(whole)


def test_streaming_lets_plain_words_through_early():
    m = MathsSpeech()
    assert m.feed("The gradient is ") == "The gradient is "  # no maths pending: no waiting for the next chunk
    assert m.feed("8/") == ""
    assert m.feed("2 here") + m.flush() == "eight over two here"


def test_tags_are_never_touched_and_cues_count_spoken_words():
    t = TagStripper()
    said = "".join(t.feed(c) for c in ["the chord [[pq]] PQ has gradient [[g", "rad]] 8/2 = 4, so [[q]] Q"]) + t.flush()
    assert said == "the chord P Q has gradient eight over two equals four, so Q"
    assert t.cues == [{"word": 2, "id": "pq"}, {"word": 6, "id": "grad"}, {"word": 12, "id": "q"}]
    words = said.split()
    assert words[2] == "P" and words[6] == "eight" and words[12] == "Q"
