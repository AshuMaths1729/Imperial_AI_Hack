"""Presentations: the tutor teaches through a pre-generated animated deck (tools drive the Slides tab). Built in WS-C."""

from livekit.agents import llm

RULES = ""  # extra system-prompt rules for teaching from slides, appended by prompting.build_instructions


def slide_tools(io, lesson_id: str) -> list[llm.FunctionTool | llm.RawFunctionTool]:
    """Function tools for the deck and the stage tabs (show_tab, slide navigation, slide pointer)."""
    return []
