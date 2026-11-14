"""ScholarTwin live avatar tutor: ElevenLabs STT -> Claude Haiku -> ElevenLabs TTS -> Synthesia avatar.

The backend (`POST /api/tutor/session`) dispatches this worker with metadata
`{tutor_id, tutors: [{tutor_id, name, avatar_id, voice_id, style_prompt, ...}]}`.
The student page switches tutor mid-call by sending a tutor id on the text stream
`tutor.switch`; the worker swaps face, voice and persona, then publishes the active id
as its participant attribute `tutor_id`.

Run: uv run avatar_agent.py dev   (TUTOR_AVATAR=0 for voice only)
"""

import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, TurnHandlingOptions, WorkerOptions, cli, room_io
from livekit.plugins import anthropic, elevenlabs, noise_cancellation, silero, synthesia

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent.parent / ".env")  # the team's repo-root .env; never overrides the above
logger = logging.getLogger("avatar-tutor")

RULES = (
    "Everything you say is spoken aloud through a live video avatar: one to three short sentences "
    "per turn, no markdown, lists or symbols. If you are interrupted, respond to what the student "
    "said before continuing. Speak English unless the student speaks another language."
)
MAX_AVATARS = 5  # Synthesia precomputes at most five swappable avatars per session


def parse_meta(raw: str) -> tuple[str, dict[str, dict]]:
    meta = json.loads(raw or "{}")
    tutors = {t["tutor_id"]: t for t in meta["tutors"]}
    return meta["tutor_id"], tutors


def avatar_ids(tutors: dict[str, dict], active: str) -> list[str]:
    """Unique avatar ids, the active tutor's first (Synthesia's 'default')."""
    ids = [tutors[active]["avatar_id"]] + [t["avatar_id"] for t in tutors.values()]
    return list(dict.fromkeys(ids))[:MAX_AVATARS]


def instructions(tutor: dict) -> str:
    return f"{tutor['style_prompt']}\n\n{RULES}"


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    active, tutors = parse_meta(ctx.job.metadata)
    await ctx.connect()

    tts = elevenlabs.TTS(voice_id=tutors[active]["voice_id"], model="eleven_flash_v2_5")
    session = AgentSession(
        stt=elevenlabs.STT(model="scribe_v2_realtime"),
        llm=anthropic.LLM(model="claude-haiku-5-5", caching="ephemeral", max_tokens=300),
        tts=tts,
        vad=ctx.proc.userdata["vad"],
        use_tts_aligned_transcript=True,  # word-synced captions on the page
        # The avatar's audio output can't pause, so a false interruption kills the reply for good:
        # only real speech (>=0.8 s and 2+ words) may cut the tutor off.
        turn_handling=TurnHandlingOptions(
            interruption={"enabled": True, "min_duration": 0.8, "min_words": 2},
            endpointing={"min_delay": 0.6},
            preemptive_generation={"enabled": True},
        ),
    )
    agent = Agent(instructions=instructions(tutors[active]))

    ids = avatar_ids(tutors, active)
    avatar: synthesia.AvatarSession | None = None
    if os.environ.get("TUTOR_AVATAR") != "0":
        # must be started before session.start, or the avatar never appears
        try:
            avatar = synthesia.AvatarSession(synthesia.AvatarConfig(avatar_ids=ids))
            await avatar.start(session, room=ctx.room)
        except synthesia.SynthesiaError as e:
            logger.warning("avatar unavailable (%s); continuing voice only", e)
            avatar = None

    switching = asyncio.Lock()
    tasks: set[asyncio.Task] = set()

    async def switch(tutor_id: str) -> None:
        nonlocal active
        async with switching:
            if tutor_id not in tutors or tutor_id == active:
                return
            old, new = tutors[active], tutors[tutor_id]
            active = tutor_id
            session.interrupt()
            if avatar and new["avatar_id"] != old["avatar_id"]:
                target = "default" if new["avatar_id"] == ids[0] else new["avatar_id"]
                try:
                    await avatar.swap_avatar(target)
                except synthesia.SynthesiaError as e:
                    logger.warning("avatar swap failed (%s); keeping the current face", e)
            tts.update_options(voice_id=new["voice_id"])
            await agent.update_instructions(instructions(new))
            await ctx.room.local_participant.set_attributes({"tutor_id": tutor_id})
            session.generate_reply(
                instructions=f"You are {new['name']} and just took over this lesson from {old['name']}. "
                "Introduce yourself in one sentence in your own style and offer to continue where the student was."
            )

    async def on_switch(reader: rtc.TextStreamReader) -> None:
        await switch((await reader.read_all()).strip())

    def spawn(reader: rtc.TextStreamReader, _who: str) -> None:
        task = asyncio.create_task(on_switch(reader))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    ctx.room.register_text_stream_handler("tutor.switch", spawn)

    await session.start(
        agent=agent,
        room=ctx.room,
        # BVC drops other people talking near the student's mic (LiveKit Cloud only)
        room_options=room_io.RoomOptions(audio_input=room_io.AudioInputOptions(noise_cancellation=noise_cancellation.BVC())),
    )
    await ctx.room.local_participant.set_attributes({"tutor_id": active})
    session.generate_reply(instructions="Greet the student in one sentence, say your name, and ask what they'd like to learn.")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=os.environ.get("TUTOR_AGENT_NAME", "scholartwin-tutor"),
        )
    )
