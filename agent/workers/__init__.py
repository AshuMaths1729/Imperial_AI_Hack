from typing import Literal

from .animate import UNAVAILABLE, animate
from .illustrate import FALLBACK, illustrate


def is_fallback(ops: list[dict]) -> bool:
    """True when a worker returned its placeholder instead of a real visual."""
    return ops in (UNAVAILABLE, FALLBACK)


async def run_visual(kind: Literal["illustration", "animation"], brief: str, board_text: str) -> list[dict]:
    """Slow visual worker entry point; returns contract-valid board ops, never raises on provider failure."""
    if kind == "illustration":
        return await illustrate(brief)
    return await animate(brief, board_text)
