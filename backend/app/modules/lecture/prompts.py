"""Prompts for lecture extraction. Bump PROMPT_VERSION when the text changes (cache key)."""

from __future__ import annotations

PROMPT_VERSION = "lecture.extract.v1"

EXTRACT_PROMPT = """\
You turn a lecture PDF (slides or notes) into a concept graph for a student.

Extract 8 to 30 distinct concepts that the lecture actually teaches. For each concept give:
- label: a short, canonical name (1-5 words), no trailing punctuation;
- summary: one or two plain sentences explaining it, grounded in the lecture;
- page: the 1-based page/slide number where the concept is first introduced;
- aliases: other names the lecture uses for the same thing (empty if none).

Then list prerequisite pairs: `prerequisite` must be understood before `dependent`. Refer to
concepts by their exact `label`. Only include pairs that are genuinely needed (a sparse,
meaningful DAG is better than a dense one). Never make a concept its own prerequisite and
avoid cycles.

Do not invent concepts that are not in the document. Do not include administrative content
(title, agenda, references, acknowledgements) as concepts.
"""


def extract_instructions(page_count: int, truncated_from: int | None = None) -> str:
    text = (
        f"The attached PDF has {page_count} pages. Extract the concept graph as instructed; "
        f"`page` must be between 1 and {page_count}."
    )
    if truncated_from:
        text += (
            f" Note: the original document has {truncated_from} pages; only the first "
            f"{page_count} are attached."
        )
    return text
