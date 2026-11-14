"""ScholarTwin live tutor worker: ElevenLabs STT -> Claude Haiku -> ElevenLabs TTS (+ Synthesia avatar),
driving the shared whiteboard over RPC and writing lesson memory to the backend.

Run: uv run agent.py dev   (TUTOR_AVATAR=0 for voice only)
"""

import asyncio
import base64
import json
import logging
import os

import httpx
from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobProcess,
    TurnHandlingOptions,
    WorkerOptions,
    cli,
    llm,
    room_io,
)
from livekit.agents.utils import images
from livekit.plugins import anthropic, elevenlabs, silero, synthesia

from circle import handle_circle, handle_lost
from lesson_end import LessonEnder
from prompting import build_instructions, greeting_instruction
from rolling import RollingSummary, haiku_summarize
from tutor_tools import TutorTools

load_dotenv()
logger = logging.getLogger("tutor")

SUMMARY_ID = "lesson-summary"


class RoomTutorIO:
    """TutorIO over the LiveKit room (board RPCs to the student page, latest screen-share frame) + backend HTTP."""

    def __init__(self, room: rtc.Room, http: httpx.AsyncClient):
        self.room = room
        self.http = http
        self._frame: rtc.VideoFrame | None = None
        self._tasks: set[asyncio.Task] = set()
        room.on("track_subscribed", self._on_track)
        for p in room.remote_participants.values():  # tracks subscribed before we started listening
            for pub in p.track_publications.values():
                if pub.track:
                    self._on_track(pub.track, pub, p)

    def _student(self) -> str | None:
        return next((i for i in self.room.remote_participants if i.startswith("student-")), None)

    async def rpc(self, method: str, payload: dict) -> dict:
        student = self._student()
        if student is None:
            raise RuntimeError("the student's page is not connected")
        reply = await self.room.local_participant.perform_rpc(
            destination_identity=student, method=method, payload=json.dumps(payload), response_timeout=5
        )
        return json.loads(reply)

    async def post(self, path: str, body: dict) -> dict:
        r = await self.http.post(path, json=body)
        r.raise_for_status()
        return r.json()

    def latest_screen_frame(self) -> str | None:
        if self._frame is None:
            return None
        opts = images.EncodeOptions(
            format="JPEG", quality=80,
            resize_options=images.ResizeOptions(width=1280, height=1280, strategy="scale_aspect_fit"),
        )
        return base64.b64encode(images.encode(self._frame, opts)).decode()

    def _on_track(self, track: rtc.Track, pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        if pub.source == rtc.TrackSource.SOURCE_SCREENSHARE and track.kind == rtc.TrackKind.KIND_VIDEO:
            task = asyncio.create_task(self._keep_latest(track))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _keep_latest(self, track: rtc.Track) -> None:
        stream = rtc.VideoStream(track)
        try:
            async for ev in stream:
                self._frame = ev.frame
        finally:
            self._frame = None  # share stopped
            await stream.aclose()


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: JobContext) -> None:
    meta = json.loads(ctx.job.metadata or "{}")
    logger.info("lesson job", extra={"lesson": meta})
    lesson_id = meta["lesson_id"]
    http = httpx.AsyncClient(base_url=os.environ.get("TUTOR_API_BASE", "http://localhost:8000"), timeout=10)

    async def fetch_context() -> dict:
        r = await http.get(f"/api/tutor/context/{lesson_id}")
        r.raise_for_status()
        return r.json()

    _, tctx = await asyncio.gather(ctx.connect(), fetch_context())

    io = RoomTutorIO(ctx.room, http)
    tools = TutorTools(io, lesson_id)
    rolling = RollingSummary(haiku_summarize)
    ender = LessonEnder(io.post, lesson_id)
    tasks: set[asyncio.Task] = set()

    def spawn(coro) -> None:
        task = asyncio.create_task(coro)
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    async def on_shutdown() -> None:
        # runs when the room closes (student left -> session closes -> room deleted), so /end is always posted
        summary = rolling.summary
        if rolling.recent:
            try:
                summary = await asyncio.wait_for(haiku_summarize(rolling.summary, rolling.recent), 5)
            except Exception:
                logger.exception("final summary failed; using rolling summary")
        try:
            await ender.end(summary or "(no conversation)", tools.covered)
            logger.info("lesson %s ended", lesson_id)
        except Exception:
            logger.exception("posting /end failed")
        await http.aclose()

    ctx.add_shutdown_callback(on_shutdown)

    session = AgentSession(
        stt=elevenlabs.STT(model="scribe_v2_realtime"),
        llm=anthropic.LLM(model="claude-haiku-5-5", caching="ephemeral", max_tokens=300),
        tts=elevenlabs.TTS(voice_id=tctx["tutor"]["voice_id"], model="eleven_flash_v2_5"),
        vad=ctx.proc.userdata["vad"],
        use_tts_aligned_transcript=True,  # word-synced tutor captions
        turn_handling=TurnHandlingOptions(
            interruption={"enabled": True, "min_duration": 0.3},
            preemptive_generation={"enabled": True},
        ),
    )
    agent = Agent(instructions=build_instructions(tctx), tools=tools.function_tools())

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        item = ev.item
        if item.type == "message" and item.role in ("user", "assistant"):
            rolling.add_turn(item.role, item.text_content or "")
            if item.role == "assistant":
                spawn(fold())

    async def fold() -> None:
        if not await rolling.maybe_fold():
            return
        chat = agent.chat_ctx.copy()
        chat.items[:] = [i for i in chat.items if i.id != SUMMARY_ID]
        chat.truncate(max_items=2 * rolling.keep_last)  # items, incl. tool calls/outputs; keeps the instructions
        first_is_instructions = chat.items and chat.items[0].type == "message" and chat.items[0].role == "system"
        summary = llm.ChatMessage(id=SUMMARY_ID, role="system", content=[f"Lesson so far: {rolling.summary}"])
        chat.items.insert(1 if first_is_instructions else 0, summary)
        await agent.update_chat_ctx(chat)

    async def on_circle(text: str) -> None:
        try:
            board = await tools.board_text()
        except Exception:
            board = "(board unavailable)"
        await handle_circle(agent, session, json.loads(text), board)

    async def read_bytes(reader: rtc.ByteStreamReader) -> None:
        await on_circle(b"".join([chunk async for chunk in reader]).decode())

    async def on_lost(reader: rtc.TextStreamReader) -> None:
        await reader.read_all()
        await handle_lost(agent, session)

    async def read_text(reader: rtc.TextStreamReader) -> None:
        await on_circle(await reader.read_all())

    ctx.room.register_text_stream_handler("tutor.circle", lambda reader, _who: spawn(read_text(reader)))
    ctx.room.register_byte_stream_handler("tutor.circle", lambda reader, _who: spawn(read_bytes(reader)))
    ctx.room.register_text_stream_handler("tutor.lost", lambda reader, _who: spawn(on_lost(reader)))

    if os.environ.get("TUTOR_AVATAR") != "0":
        # must be started before session.start, or the avatar never appears
        try:
            avatar = synthesia.AvatarSession(synthesia.AvatarConfig(avatar_ids=[tctx["tutor"]["avatar_id"]]))
            await avatar.start(session, room=ctx.room)
        except synthesia.SynthesiaError as e:
            logger.warning("avatar unavailable (%s); continuing voice only", e)

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(delete_room_on_close=True),
    )
    session.generate_reply(instructions=greeting_instruction(tctx))


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=os.environ.get("TUTOR_AGENT_NAME", "synthesia-avatar-agent"),
        )
    )
