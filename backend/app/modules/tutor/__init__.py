"""Live tutor lane: pick a tutor and join a LiveKit room where the avatar agent (`agent/`) talks.

Routes (all under /api):

  GET  /tutor/tutors                -> [{tutor_id, name, tagline, avatar_id, voice_id}]
  POST /tutor/session {tutor_id}    -> {url, token, room, identity}   (503 without LIVEKIT_*)

The token dispatches the agent `TUTOR_AGENT_NAME` with metadata `{tutor_id, tutors}`, so the
agent gets every persona from here and can switch tutors mid-call.
"""

from app.modules.tutor.router import router

__all__ = ["router"]
