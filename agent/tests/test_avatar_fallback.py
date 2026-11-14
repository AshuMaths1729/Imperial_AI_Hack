from livekit.agents import AgentSession
from livekit.agents.voice.io import AudioOutput, AudioOutputCapabilities
from livekit.plugins import synthesia

from agent import start_avatar


class DeadSink(AudioOutput):
    def __init__(self):
        super().__init__(label="dead-avatar", capabilities=AudioOutputCapabilities(pause=False), sample_rate=24000)

    async def capture_frame(self, frame): ...
    def flush(self): ...
    def clear_buffer(self): ...


class TimingOutAvatar:
    """Mimics synthesia _launch: installs its audio sink, then times out waiting for the avatar to join."""

    async def start(self, session, room):
        session.output.replace_audio_tail(DeadSink())
        raise synthesia.SynthesiaError("avatar did not join within 12s", type=synthesia.ErrorType.TIMEOUT)


class JoiningAvatar:
    async def start(self, session, room):
        session.output.replace_audio_tail(DeadSink())


async def test_avatar_timeout_falls_back_to_voice_only():
    session = AgentSession()
    assert await start_avatar(session, None, TimingOutAvatar) is False
    assert session.output.audio is None  # RoomIO publishes the tutor's audio itself


async def test_avatar_success_keeps_its_sink():
    session = AgentSession()
    assert await start_avatar(session, None, JoiningAvatar) is True
    assert session.output.audio is not None


async def test_avatar_construction_error_is_voice_only():
    def bad_config():
        raise synthesia.SynthesiaError("SYNTHESIA_API_KEY is not set", type=synthesia.ErrorType.AUTH)

    session = AgentSession()
    assert await start_avatar(session, None, bad_config) is False
    assert session.output.audio is None
