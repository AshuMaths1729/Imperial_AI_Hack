"""Posts /api/tutor/lessons/{id}/end exactly once, however many times the lesson is ended."""

import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger("tutor.lesson_end")


class LessonEnder:
    def __init__(self, post: Callable[[str, dict], Awaitable[dict]], lesson_id: str):
        self._post = post
        self._lesson_id = lesson_id
        self._task: asyncio.Future | None = None

    async def end(self, summary: str, covered_kp_ids: list[str]) -> None:
        if self._task is None:
            body = {"summary": summary, "covered_kp_ids": covered_kp_ids}
            self._task = asyncio.ensure_future(self._post(f"/api/tutor/lessons/{self._lesson_id}/end", body))
        await self._task


async def finish_lesson(rolling, ender: LessonEnder, covered_kp_ids: list[str], summarize,
                        summary_timeout: float = 5, end_timeout: float = 3) -> None:
    """Shutdown path: final summary (<= 5 s) then /end (<= 3 s), inside the worker's 15 s shutdown budget."""
    summary = rolling.summary
    if rolling.recent:
        try:
            summary = await asyncio.wait_for(summarize(rolling.summary, rolling.recent), summary_timeout)
        except Exception:
            logger.exception("final summary failed; using rolling summary")
    try:
        await asyncio.wait_for(ender.end(summary or "(no conversation)", covered_kp_ids), end_timeout)
    except Exception:
        logger.exception("posting /end failed")
