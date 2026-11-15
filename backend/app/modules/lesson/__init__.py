"""Live lesson lane (LectureUnderstanding): tracks, lessons, animated slide decks, PDF materials and LiveKit
sessions for the live tutor agent (`agent/agent.py`).

Routes (all under /api/lesson): tracks, materials (incl. PDF), deck, session, context, progress, lesson state, end.
"""

from app.modules.lesson.router import tutor_router as router

__all__ = ["router"]
