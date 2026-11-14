"""Lesson memory: the main branch (the deck: one idea per slide, in order) and side branches (detours), with the
student's understanding per concept. Checkpointed into the chat context and to the backend. Built in v3 WS-1."""

from livekit.agents import llm

RULES = ""  # the teaching contract and lesson-state rules, appended by prompting.build_instructions


class LessonState:
    def __init__(self, lesson_id: str, post=None):
        self.lesson_id = lesson_id
        self.post = post  # async (path, body) -> dict: the backend, for checkpoints

    def note_slide(self, index: int, step: int, idea: str = "") -> None:
        """Called by the slide tools whenever the open slide or step changes."""

    def context_text(self) -> str:
        """The compact "Lesson state" note the tutor sees every turn."""
        return ""

    async def checkpoint(self, agent) -> None:
        """After every tutor turn and every 60 s: refresh the note in the chat context and save the state."""

    def function_tools(self) -> list[llm.FunctionTool | llm.RawFunctionTool]:
        """detour_start, detour_end, mark_understanding."""
        return []
