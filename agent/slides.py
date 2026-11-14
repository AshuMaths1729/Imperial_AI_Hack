"""Presentations: the tutor teaches through a pre-generated animated deck (tools drive the Slides tab). Built in WS-C.

The deck lives on the student's page (loaded from GET /api/tutor/tracks/{id}/deck); every tool here is an RPC to
it (frontend/src/tutor/slides/rpc.ts), so the agent always sees the deck the student sees, including follow-up
slides pushed during the lesson. Indexes are 1-based, as the page reports them.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator
from livekit.agents import RunContext, llm

logger = logging.getLogger("tutor.slides")

MODEL = "claude-sonnet-5-5"
RPC_LIMIT = 14000  # LiveKit RPC payloads are capped at 15 KiB
_DECK_SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "frontend/src/tutor/slides/deck.schema.json").read_text()
)
SLIDE_SCHEMA = {"$defs": _DECK_SCHEMA["$defs"], **_DECK_SCHEMA["$defs"]["Slide"]}
_slide_validator = Draft202012Validator(SLIDE_SCHEMA)

RULES = """Slides:
- The Slides tab has an animated deck for this track, built to teach its knowledge points with intuition first. \
Right after your greeting, call show_tab("slides"); the result lists the slides and the open slide's objects and step hints.
- Teach a slide like a 3Blue1Brown video: say one short sentence, then slide_step to the next step so the animation \
lands while you talk. Use each step's hint in your own words. One step per sentence or two; never read the slide out.
- While you talk about something on the slide, slide_point at its object id.
- When a slide's knowledge point is done, ask one short check question and wait for the answer before slide_go to the next slide.
- If the student circles part of a slide or wants to see something move differently, call slide_animate: it builds \
a richer, interactive follow-up slide in a few seconds and opens it by itself; keep talking meanwhile. If what they \
circled is a derivation or calculation, show_tab("board") and work it by hand instead.
- For worked problems use the whiteboard (show_tab("board")), then come back to the slides."""

FOLLOWUP_SYSTEM = """You design ONE follow-up slide for a live tutor's animated deck, in the style of 3Blue1Brown: \
a picture that moves and builds intuition for exactly what the student asked about. Call make_slide once.
- Build on the open slide (reuse its axes ranges, curves and colours) but go deeper or show it from a new angle.
- Make it interactive when that helps: add a slider for a parameter used in a curve expr (e.g. the learning rate \
or a coefficient) so the student can drag it and watch the picture respond.
- 3 to 5 steps, each with a one-sentence narration hint for the tutor; at most 16 objects; few words on screen.
- Canvas 1600x900, title drawn for you at the top (keep content below y=150). Palette names: blue, teal, green, \
yellow, gold, red, purple, pink, white, grey (hex for latex \\color: #58C4DD #5CD0B3 #83C167 #FFE45C #F0AC5F \
#FC6255 #B08CD9 #E072C8 #ECECEC #8A8F98).
- curve expr: x (+ slider params), + - * / ^, sin cos tan exp log sqrt abs, PI, E. Dots sit on a curve at x \
(move: to x; path: hop through exact iterates you computed). tangent and step_arrow follow a dot.
- Objects never named by a show action are visible when the slide opens, so reveal most of them in steps.
- Every id referenced must exist on this slide; keep dots and labels inside their axes."""

SLIDE_TOOL = {
    "name": "make_slide",
    "description": "Submit the follow-up slide.",
    "input_schema": SLIDE_SCHEMA,
}


def slide_problems(slide: Any) -> list[str]:
    return [f"{'/'.join(map(str, e.path)) or 'slide'}: {e.message[:160]}" for e in _slide_validator.iter_errors(slide)][:12]


def outline_text(d: dict) -> str:
    """The page's slides.describe reply as compact text for the voice model."""
    if not d.get("ok", True) or "slides" not in d:
        return f"couldn't read the slides: {'; '.join(d.get('errors') or ['no reply'])}"
    lines = [f"Deck: slide {d['index']} of {len(d['slides'])} is open, at step {d['step']}."]
    for s in d["slides"]:
        mark = "  <- open" if s["index"] == d["index"] else ""
        extra = " (follow-up)" if s.get("followup") else ""
        kps = f" [{', '.join(s['kp_ids'])}]" if s.get("kp_ids") else ""
        lines.append(f"{s['index']}. {s['title']}{kps}{extra}, {s['steps']} steps{mark}")
    cur = d.get("current")
    if cur:
        objs = ", ".join(f"{o['id']} ({o['kind']}{': ' + o['label'] if o.get('label') else ''})" for o in cur["objects"])
        lines.append(f'Open slide "{cur["title"]}" objects: {objs}')
        lines += [f"step {i}: {n}" for i, n in enumerate(cur["narration"], 1)]
    return "\n".join(lines)


async def _note(ctx: RunContext | None, text: str, speak: str | None = None) -> None:
    """Tell the tutor (chat context) that something happened in the background; speak up if nobody is talking."""
    if ctx is None:
        return
    session = ctx.session
    agent = session.current_agent
    chat = agent.chat_ctx.copy()
    chat.add_message(role="system", content=text)
    await agent.update_chat_ctx(chat)
    if speak and session.agent_state == "listening" and session.user_state != "speaking":
        session.generate_reply(instructions=speak)


class SlideTools:
    def __init__(self, io, lesson_id: str, client=None, timeout_s: float = 60.0):
        self.io = io
        self.lesson_id = lesson_id
        self.client = client  # anthropic.AsyncAnthropic-like; created lazily (tests inject a fake)
        self.timeout_s = timeout_s
        self.narration: list[str] = []  # step hints of the open slide, from the last describe
        self._tasks: set[asyncio.Task] = set()

    async def _rpc(self, method: str, payload: dict) -> dict:
        try:
            return await self.io.rpc(method, payload)
        except Exception as e:
            return {"ok": False, "errors": [f"slides unreachable: {e}"]}

    async def describe(self) -> str:
        d = await self._rpc("slides.describe", {})
        if d.get("ok") is not False:
            self.narration = (d.get("current") or {}).get("narration") or []
        return outline_text(d)

    @staticmethod
    def _failed(reply: dict) -> str | None:
        if reply.get("ok"):
            return None
        return f"failed: {'; '.join(str(e) for e in reply.get('errors') or ['no reply'])}"

    async def show_tab(self, tab: Literal["board", "slides"]) -> str:
        if err := self._failed(await self._rpc("ui.show_tab", {"tab": tab})):
            return err
        return await self.describe() if tab == "slides" else "ok: showing the whiteboard"

    async def slide_go(self, index: int) -> str:
        if err := self._failed(await self._rpc("slides.go", {"index": index})):
            return err
        return "ok\n" + await self.describe()

    async def slide_step(self, step: int) -> str:
        reply = await self._rpc("slides.step", {"step": step})
        if err := self._failed(reply):
            return err
        total = len(self.narration)
        nxt = f" Next: {self.narration[step]}" if step < total else " That was the last step of this slide."
        return f"ok: slide {reply.get('index')}, step {step} of {total or '?'}.{nxt}"

    async def slide_point(self, object_id: str) -> str:
        return self._failed(await self._rpc("slides.point", {"id": object_id})) or f"ok: pointing at {object_id}"

    async def slide_animate(self, brief: str, object_ids: list[str] | None = None, ctx: RunContext | None = None) -> str:
        task = asyncio.create_task(self._animate(brief, object_ids or [], ctx))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return ("queued: building the follow-up animation; it opens on the Slides tab by itself in about 10-20 seconds. "
                "Meanwhile talk about the idea itself; do not describe the animation until a note says it is on screen.")

    async def _plan(self, messages: list) -> tuple[Any, Any]:
        if self.client is None:
            import anthropic

            self.client = anthropic.AsyncAnthropic()  # ANTHROPIC_API_KEY from env
        resp = await asyncio.wait_for(
            self.client.messages.create(
                model=MODEL, max_tokens=6000, system=FOLLOWUP_SYSTEM, tools=[SLIDE_TOOL],
                # Sonnet 5.5 rejects a forced tool_choice; FOLLOWUP_SYSTEM names the tool. No thinking: it must land in seconds.
                tool_choice={"type": "auto"}, thinking={"type": "between_tools"}, messages=messages,
            ),
            self.timeout_s,
        )
        use = next(b for b in resp.content if b.type == "tool_use")
        return resp, use

    async def _animate(self, brief: str, object_ids: list[str], ctx: RunContext | None) -> None:
        note = f"Follow-up animation unavailable: {brief}. Explain it in words or on the board instead."
        speak = None
        try:
            d = await self._rpc("slides.describe", {"slide": True})
            context = json.dumps(d.get("slide")) if d.get("slide") else outline_text(d)
            messages: list = [{"role": "user", "content": (
                f"The student asked about: {brief}\nCircled objects: {', '.join(object_ids) or 'none'}\n\n"
                f"The open slide:\n{context}"
            )}]
            for attempt in range(2):
                resp, use = await self._plan(messages)
                slide = use.input
                problems = slide_problems(slide)
                if not problems and len(json.dumps(slide)) > RPC_LIMIT:
                    problems = [f"the slide JSON is over {RPC_LIMIT} bytes; use fewer objects, points and path iterates"]
                if not problems:
                    reply = await self._rpc("slides.push", {"slide": slide})
                    if reply.get("ok"):
                        steps = len(slide.get("steps") or [])
                        hints = "; ".join(f"step {i}: {s.get('narration', '')}" for i, s in enumerate(slide.get("steps") or [], 1))
                        note = (f"Follow-up animation is on screen now as slide {reply.get('index')} "
                                f"\"{slide.get('title')}\" ({steps} steps; {hints}). Walk the student through it with slide_step.")
                        speak = "Your follow-up animation just opened on the Slides tab. Introduce it in one sentence, then play step 1."
                        await self.describe()
                        break
                    problems = [str(e) for e in reply.get("errors") or ["the page rejected the slide"]]
                logger.info("follow-up slide attempt %d rejected: %s", attempt + 1, problems)
                messages += [
                    {"role": "assistant", "content": resp.content},
                    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": use.id, "is_error": True,
                                                  "content": "Fix and call make_slide again:\n" + "\n".join(problems)}]},
                ]
        except Exception:
            logger.exception("follow-up slide failed")
        try:
            await _note(ctx, note, speak)
        except Exception:
            logger.exception("follow-up note failed")

    def function_tools(self) -> list[llm.FunctionTool | llm.RawFunctionTool]:
        t = self

        @llm.function_tool
        async def show_tab(tab: Literal["board", "slides"]) -> str:
            """Switch the student's main stage to the whiteboard or the animated slides. Showing the slides returns the deck outline and the open slide's object ids and step hints.

            Args:
                tab: board or slides
            """
            return await t.show_tab(tab)

        @llm.function_tool
        async def slide_go(index: int) -> str:
            """Open slide number `index` (1-based) at its first step; returns its object ids and step hints.

            Args:
                index: slide number from the outline, starting at 1
            """
            return await t.slide_go(index)

        @llm.function_tool
        async def slide_step(step: int) -> str:
            """Play the open slide up to `step` (1 = first step). Normally the next step; earlier numbers rewind.

            Args:
                step: step number, 0 shows the slide as it opened
            """
            return await t.slide_step(step)

        @llm.function_tool
        async def slide_point(object_id: str) -> str:
            """Point the red laser at an object on the open slide while you talk about it.

            Args:
                object_id: id from the open slide's object list
            """
            return await t.slide_point(object_id)

        @llm.function_tool
        async def slide_animate(context: RunContext, brief: str, object_ids: list[str]) -> str:
            """Build a richer, interactive follow-up animation slide for what the student circled or asked about (background, a few seconds; it opens by itself).

            Args:
                brief: one or two sentences: what to show and what the student is confused about
                object_ids: ids of the circled objects on the open slide, or []
            """
            return await t.slide_animate(brief, object_ids, context)

        return [show_tab, slide_go, slide_step, slide_point, slide_animate]


def slide_tools(io, lesson_id: str) -> list[llm.FunctionTool | llm.RawFunctionTool]:
    """Function tools for the deck and the stage tabs (show_tab, slide navigation, slide pointer, follow-up animation)."""
    return SlideTools(io, lesson_id).function_tools()
