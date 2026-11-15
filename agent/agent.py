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
    APIConnectOptions,
    SessionConnectOptions,
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
import slides
import watch
from lesson_state import LessonState
from tutor_tools import TutorTools

load_dotenv()
logger = logging.getLogger("tutor")

SUMMARY_ID = "lesson-summary"
AVATAR_JOIN_TIMEOUT = 12  # plugin default 30 s; a student should not wait that long for voice-only
# A step-by-step board_write (5+ LaTeX steps) needs ~800+ tokens; at the limit the tool call is cut off and
# LiveKit drops it, so the tutor silently says and draws nothing. Only generated tokens count, so headroom is cheap.
VOICE_MAX_TOKENS = 2000
# One turn teaches a whole slide (sentence, slide_step, slide_point, ...); LiveKit's default of 3 stops it mid-slide.
MAX_TOOL_STEPS = 12
SPEECH_SPEED = 0.9  # 3Blue1Brown pace; ElevenLabs allows 0.8-1.2
CHECKPOINT_EVERY_S = 60
# Measured on the live prompt: Haiku 5.5 without thinking ~1 s to first token but it followed the teaching rules
# badly; Sonnet 5.5 without thinking ~1.2 s and follows them.
VOICE_MODEL = "claude-sonnet-5-5"
LLM_TIMEOUT_S = 25  # the first, cache-writing call takes 5-9 s; the 10 s default made it time out and retry
CONTINUE_AFTER_S = 2.0  # silence after a mid-slide stop before the agent nudges the tutor on


class VoiceLLM(anthropic.LLM):
    """The voice brain without thinking (thinking adds ~2 s before every reply), one tool call at a time."""

    EXTRA = {"thinking": {"type": "between_tools"}}  # Sonnet 5.5: thinking off (disabled is a 400 there)

    def __init__(self, **kw):
        # one tool call at a time: parallel slide_step calls (live: steps 1, 3, 2 at once) break the pacing
        super().__init__(parallel_tool_calls=False, **kw)

    def chat(self, *, extra_kwargs=None, **kw):
        more = extra_kwargs if isinstance(extra_kwargs, dict) else {}  # callers may pass NOT_GIVEN
        return super().chat(extra_kwargs={**self.EXTRA, **more}, **kw)


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
                after_tutor_turn(item.text_content or "")


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
        llm=VoiceLLM(model=VOICE_MODEL, caching="ephemeral", max_tokens=VOICE_MAX_TOKENS),
        conn_options=SessionConnectOptions(llm_conn_options=APIConnectOptions(timeout=LLM_TIMEOUT_S)),
        tts=elevenlabs.TTS(
            voice_id=tctx["tutor"]["voice_id"], model="eleven_flash_v2_5",
            voice_settings=elevenlabs.VoiceSettings(stability=0.5, similarity_boost=0.75, speed=SPEECH_SPEED),
        ),
        vad=ctx.proc.userdata["vad"],
        use_tts_aligned_transcript=True,  # word-synced tutor captions
        max_tool_steps=MAX_TOOL_STEPS,
        turn_handling=TurnHandlingOptions(
            interruption={"enabled": True, "min_duration": 0.5, "min_words": 2},  # a cough or stray "No." keeps talking
            preemptive_generation={"enabled": True},
        ),
    )
    lesson = LessonState(lesson_id, io.post, resume=tctx.get("resume"))
    deck = slides.SlideTools(io, lesson_id, lesson=lesson)  # picks up the last lesson's understanding
    agent = Agent(
        instructions=build_instructions(tctx),
        tools=tools.function_tools() + deck.function_tools() + lesson.function_tools(),
    )

    async def keep_teaching(said: str) -> None:
        # code owns the pace: a mid-slide stop with no question asked must not leave the student in silence
        if not (nudge := deck.continue_instruction(said)):
            return
        step = deck.step
        await asyncio.sleep(CONTINUE_AFTER_S)
        if session.agent_state == "listening" and session.user_state != "speaking" and deck.step == step:
            logger.info("tutor stopped mid-slide; nudging on to step %s", (step or 0) + 1)
            session.generate_reply(instructions=nudge)

    def after_tutor_turn(said: str) -> None:
        spawn(fold())
        spawn(lesson.checkpoint(agent))
        spawn(keep_teaching(said))

    track_turns(session, rolling, after_tutor_turn)
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
        lesson.apply(chat)  # a fold must not drop the lesson-state note until the next checkpoint
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

    async def on_idle(reader: rtc.TextStreamReader) -> None:
        await watch.handle_idle(agent, session, tools, json.loads(await reader.read_all()))

    ctx.room.register_text_stream_handler("tutor.idle", lambda reader, _who: spawn(on_idle(reader)))

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
    resume = tctx.get("resume") or {}
    if resume.get("slide"):
        # put the slide back where the student stopped, so the recap points at a picture they can see
        await deck.slide_go(int(resume["slide"]))
        if step := min(int(resume.get("step") or 0), len(deck.narration)):  # extra steps from edits are not in the deck
            await deck.slide_step(step)
    session.generate_reply(instructions=greeting_instruction(tctx))

    async def checkpoint_loop() -> None:
        while True:
            await asyncio.sleep(CHECKPOINT_EVERY_S)
            await lesson.checkpoint(agent)

    spawn(checkpoint_loop())


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=os.environ.get("TUTOR_AGENT_NAME") or "scholartwin-tutor",
            shutdown_process_timeout=15,  # final summary <= 5 s + /end <= 3 s, with headroom
        )
    )
