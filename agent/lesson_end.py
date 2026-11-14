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
    logger.info("finishing lesson: %d recent turns, rolling summary %d chars", len(rolling.recent), len(rolling.summary))
    summary = ""
    if rolling.recent:
        try:
            summary = await asyncio.wait_for(summarize(rolling.summary, rolling.recent), summary_timeout)
        except Exception:
            logger.exception("final summary failed; using rolling summary + last turns")
    # the rolling summary is empty until the first fold (~16 turns): never drop the conversation itself
    fallback = "\n".join([rolling.summary, *rolling.recent[-10:]]).strip()[:2000]
    try:
        await asyncio.wait_for(ender.end(summary or fallback or "(no conversation)", covered_kp_ids), end_timeout)
    except Exception:
        logger.exception("posting /end failed")
