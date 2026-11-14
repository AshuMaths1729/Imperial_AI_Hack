"""Prompts for quiz generation. Bump PROMPT_VERSION when the text changes (cache key)."""

from __future__ import annotations

PROMPT_VERSION = "quiz.gen.v1"

QUIZ_PROMPT = """\
You write multiple-choice questions that check whether a student understands ONE concept
from a lecture. You are given the concept, its neighbours in the concept graph, and (when
available) the text of the slide where it appears.

Write exactly 3 questions of increasing difficulty (recall, understanding, application).
Each question has:
- question: self-contained, unambiguous;
- options: exactly 4 plausible answer strings (no "all of the above", no letter prefixes);
- correct_index: 0-3, the index of the single correct option (vary it across questions);
- explanation: 1-3 sentences saying why the answer is right and what the common wrong
  options get wrong.

Base the questions only on the material provided. Do not ask about slide numbers or layout.
"""

REL_TEXT = {
    "prerequisite_in": "is a prerequisite of this concept",
    "prerequisite_out": "builds on this concept",
    "supports": "supports",
    "contradicts": "contradicts",
    "gap": "is an untested gap with",
}
