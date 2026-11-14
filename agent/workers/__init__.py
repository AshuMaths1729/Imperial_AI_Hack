from typing import Literal

from .animate import animate
from .illustrate import illustrate


async def run_visual(kind: Literal["illustration", "animation"], brief: str, board_text: str) -> list[dict]:
    """Slow visual worker entry point; returns contract-valid board ops, never raises on provider failure."""
    if kind == "illustration":
        return await illustrate(brief)
    return await animate(brief, board_text)
