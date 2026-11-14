"""Voice lane: ElevenLabs TTS/STT and the Anam avatar session token.

Routes (all under /api):

  POST /tts            {text, voice_id?}            -> {media_id, url, cached}
  POST /tts/segments   {segments:[{text}], voice_id?} -> [{media_id, url, cached}, ...]
  GET  /media/{id}     cached mp3 (audio/mpeg)
  POST /stt            multipart `file`             -> {transcript}   (503 -> use browser STT)
  POST /avatar/session                              -> {mode: avatar|audio_only, session_token?}

Audio is cached on disk under `settings.state_dir/media`; `scripts/pregen_audio.py` fills the
same cache so the demo works offline.
"""

from app.modules.voice.router import router

__all__ = ["router"]
