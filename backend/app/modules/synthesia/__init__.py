"""Synthesia lane: pre-rendered avatar clips (async renders, polled on read, cached on disk).

Routes (all under /api):

  POST /avatar/clips        {script, title?, avatar?} -> {clip_id, status}   (202 new, 200 existing)
  POST /avatar/clips/lookup {script, avatar?}         -> {found, clip_id, status, ready, video_url}
  GET  /avatar/clips                                  -> [{clip_id, title, status, ready}]
  GET  /avatar/clips/{id}   (refreshes status)        -> {clip_id, status, ready, video_url, ...}
  GET  /avatar/clips/{id}/video                       -> the MP4 (video/mp4)
  POST /avatar/session                                -> {mode: clips|audio_only, ready_clips,
                                                          can_render}

Clips live in `settings.state_dir/clips/{clip_id}.{json,mp4}`. Unscripted answers fall back to
ElevenLabs audio (`/api/tts`) plus a still avatar image. `scripts/prerender_avatar_clips.py`
fills the cache ahead of the demo.
"""

from app.modules.synthesia.router import router

__all__ = ["router"]
