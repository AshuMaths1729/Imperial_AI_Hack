"""Watching the student's handwriting: "tutor.idle" events (they wrote, then stopped) become hints or
corrections. Built in WS-B."""

RULES = ""  # extra system-prompt rules for watching/correcting, appended by prompting.build_instructions


async def handle_idle(agent, session, tools, payload: dict) -> None:
    """payload is an IdleEvent (frontend/src/tutor/contracts/types.ts)."""
