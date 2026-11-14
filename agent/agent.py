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
from livekit.plugins import anthropic, elevenlabs, noise_cancellation, silero, synthesia

from circle import handle_circle, handle_lost
from lesson_end import LessonEnder, finish_lesson
from prompting import build_instructions, greeting_instruction
from rolling import RollingSummary, haiku_summarize
from tutor_tools import TutorTools

load_dotenv()
logger = logging.getLogger("tutor")

SUMMARY_ID = "lesson-summary"
AVATAR_JOIN_TIMEOUT = 12  # plugin default 30 s; a student should not wait that long for voice-only


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
            task.add_done_callback(log_task_exception)

    async def _keep_latest(self, track: rtc.Track) -> None:
        stream = rtc.VideoStream(track)
        try:
            async for ev in stream:
                self._frame = ev.frame
        finally:
            self._frame = None  # share stopped
            await stream.aclose()


async def start_avatar(session: AgentSession, room: rtc.Room, make_avatar) -> bool:
    """Start the avatar before session.start (or it never appears). On any failure fall back to voice only."""
    try:
        await make_avatar().start(session, room=room)
        return True
    except Exception as e:
        # the plugin installs its audio sink before waiting for the join and can't remove it; clearing it
        # lets session.start publish the tutor's audio through RoomIO instead of a dead avatar sink
        session.output.audio = None
        logger.warning("avatar unavailable (%s); continuing voice only", e)
        return False


def log_task_exception(task: asyncio.Task) -> None:
    """Done-callback for background tasks: a crash would otherwise vanish silently."""
    if not task.cancelled() and (exc := task.exception()) is not None:
        logger.error("background task failed: %r", exc, exc_info=exc)


def log_session(session: AgentSession) -> None:
    """Log every tool call with its result and every session (LLM/STT/TTS) error."""

    @session.on("function_tools_executed")
    def _on_tools(ev) -> None:
        for call, out in ev.zipped():
            status = "error" if out is None or out.is_error else "ok"
            logger.info("tool %s %s: %s", call.name, status, ((out.output if out else "") or "")[:200])

    @session.on("error")
    def _on_error(ev) -> None:
        exc = getattr(ev.error, "error", None)
        logger.error("session error from %s: %r", type(ev.source).__name__, ev.error,
                     exc_info=exc if isinstance(exc, BaseException) else None)


def track_turns(session: AgentSession, rolling: RollingSummary, after_tutor_turn) -> None:
    """Feed every spoken user/tutor turn into the rolling lesson memory (sent with /end)."""

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        item = ev.item
        if item.type == "message" and item.role in ("user", "assistant"):
            rolling.add_turn(item.role, item.text_content or "")
            if item.role == "assistant":
                after_tutor_turn()


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

    async def add_note(text: str) -> None:  # e.g. "Visual ready: ..." once a background visual is on the board
        chat = agent.chat_ctx.copy()
        chat.add_message(role="system", content=text)
        await agent.update_chat_ctx(chat)

    tools = TutorTools(io, lesson_id, on_note=add_note)
    rolling = RollingSummary(haiku_summarize)
    ender = LessonEnder(io.post, lesson_id)
    tasks: set[asyncio.Task] = set()

    def spawn(coro) -> None:
        task = asyncio.create_task(coro)
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        task.add_done_callback(log_task_exception)

    async def on_shutdown() -> None:
        # runs when the room closes (student left -> session closes -> room deleted), so /end is always posted
        await finish_lesson(rolling, ender, tools.covered, haiku_summarize)
        await http.aclose()

    ctx.add_shutdown_callback(on_shutdown)

    session = AgentSession(
        stt=elevenlabs.STT(model="scribe_v2_realtime", language_code="en"),  # ignore nearby non-English chatter
        llm=anthropic.LLM(model="claude-haiku-5-5", caching="ephemeral", max_tokens=800),  # 300 cut board_write calls off mid-JSON
        tts=elevenlabs.TTS(voice_id=tctx["tutor"]["voice_id"], model="eleven_flash_v2_5"),
        vad=ctx.proc.userdata["vad"],
        use_tts_aligned_transcript=True,  # word-synced tutor captions
        turn_handling=TurnHandlingOptions(
            interruption={"enabled": True, "min_duration": 0.5, "min_words": 2},  # a cough or stray "No." keeps talking
            preemptive_generation={"enabled": True},
        ),
    )
    agent = Agent(instructions=build_instructions(tctx), tools=tools.function_tools())

    track_turns(session, rolling, lambda: spawn(fold()))
    log_session(session)

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
        config = synthesia.AvatarConfig(avatar_ids=[tctx["tutor"]["avatar_id"]])
        await start_avatar(session, ctx.room, lambda: synthesia.AvatarSession(config, join_timeout=AVATAR_JOIN_TIMEOUT))

    await session.start(
        agent=agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            delete_room_on_close=True,
            # LiveKit Cloud BVC: strips background voices (noisy room) before VAD/STT
            audio_input=room_io.AudioInputOptions(noise_cancellation=noise_cancellation.BVC()),
        ),
    )
    session.generate_reply(instructions=greeting_instruction(tctx))


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=os.environ.get("TUTOR_AGENT_NAME") or "scholartwin-tutor",
            shutdown_process_timeout=15,  # final summary <= 5 s + /end <= 3 s, with headroom
        )
    )
