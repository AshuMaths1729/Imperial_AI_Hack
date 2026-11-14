"""Posts /api/tutor/lessons/{id}/end exactly once, however many times the lesson is ended."""

import asyncio
from collections.abc import Awaitable, Callable


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
