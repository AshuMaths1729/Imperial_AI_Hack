"""Voice lane: ElevenLabs TTS/STT.

Routes (all under /api):

  POST /tts            {text, voice_id?}            -> {media_id, url, cached}
  POST /tts/segments   {segments:[{text}], voice_id?} -> [{media_id, url, cached}, ...]
  GET  /media/{id}     cached mp3 (audio/mpeg)
  POST /stt            multipart `file`             -> {transcript}   (503 -> use browser STT)

Audio is cached on disk under `settings.state_dir/media`; `scripts/pregen_audio.py` fills the
same cache so the demo works offline.
"""

from app.modules.voice.router import router

__all__ = ["router"]
