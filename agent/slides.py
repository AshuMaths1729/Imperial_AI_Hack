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
# slides.edit: new objects and steps appended to the open slide (same item schemas as a deck slide)
EDIT_SCHEMA = {
    "$defs": _DECK_SCHEMA["$defs"], "type": "object", "additionalProperties": False, "required": ["objects", "steps"],
    "properties": {
        "objects": {**_DECK_SCHEMA["$defs"]["Slide"]["properties"]["objects"], "minItems": 0, "maxItems": 8},
        "steps": {"type": "array", "items": {"$ref": "#/$defs/Step"}, "minItems": 1, "maxItems": 4},
    },
}
_edit_validator = Draft202012Validator(EDIT_SCHEMA)

RULES = """Slides (slowly, one idea at a time):
- Right after your greeting, call show_tab("slides"); the result lists the slides and the open slide's idea, check \
question, objects and step hints.
- Open every slide with one bridge sentence from the last one ("We just saw X; now..."), then its question.
- Each step: 2-3 short sentences in your own words from its hint, then slide_step to the next step (it returns when \
the animation has finished). slide_point at what you are talking about. Never read the slide out.
- Once per slide, before a reveal, ask what they think will happen and wait for the answer. Otherwise go on \
through the steps without waiting for the student.
- After the last step, ask the slide's check question and wait. slide_go to the next slide only after a good answer; \
otherwise explain again on this slide.
- A question about the open slide is answered ON it: slide_edit adds steps to it (it builds in the background and \
tells you which steps to play). Never jump to a new slide for it; slide_animate (a new slide) only for an idea that is \
not on this slide.
- A circle stays on screen until you call clear_circle(circle_id), once the student says your explanation helped.
- For worked problems use the whiteboard (show_tab("board")), then come back to the slides."""

_CANVAS = """- Canvas 1600x900, title drawn for you at the top (keep content below y=150). Palette names: blue, teal, green, \
yellow, gold, red, purple, pink, white, grey (hex for latex \\color: #58C4DD #5CD0B3 #83C167 #FFE45C #F0AC5F \
#FC6255 #B08CD9 #E072C8 #ECECEC #8A8F98).
- curve expr: x (+ slider params), + - * / ^, sin cos tan exp log sqrt abs, PI, E. Dots sit on a curve at x \
(move: to x; path: hop through exact iterates you computed). tangent and step_arrow follow a dot.
- Objects never named by a show action are visible when the slide opens, so reveal most new ones in steps.
- Every id referenced must exist on this slide; keep dots and labels inside their axes."""

FOLLOWUP_SYSTEM = """You design ONE follow-up slide for a live tutor's animated deck, in the style of 3Blue1Brown: \
a picture that moves and builds intuition for exactly what the student asked about. Call make_slide once.
- Build on the open slide (reuse its axes ranges, curves and colours) but go deeper or show it from a new angle.
- Make it interactive when that helps: add a slider for a parameter used in a curve expr (e.g. the learning rate \
or a coefficient) so the student can drag it and watch the picture respond.
- 3 to 5 steps, each with a one-sentence narration hint for the tutor; at most 16 objects; few words on screen.
""" + _CANVAS

EDIT_SYSTEM = """You add to the OPEN slide of a live tutor's animated deck, so the tutor answers the student's \
question right there instead of on a new slide (3Blue1Brown style). Call add_to_slide once with ONLY the new objects \
and the new steps.
- Concrete before abstract: plug in actual numbers the student can check. One idea per step (at most one new term or \
symbol). Each step's narration is a one-sentence hint for the tutor.
- Step 1 indicates what the student circled, so they see which part you are explaining.
- Reuse the slide's existing objects, axes, curves and colours: name their ids in actions (indicate, move, path, \
morph, show, hide). A quantity keeps its colour. Put new objects in free space; never cover what is there.
- 1 to 4 steps, at most 8 new objects; new ids must not exist on the slide yet.
""" + _CANVAS

SLIDE_TOOL = {
    "name": "make_slide",
    "description": "Submit the follow-up slide.",
    "input_schema": SLIDE_SCHEMA,
}
EDIT_TOOL = {
    "name": "add_to_slide",
    "description": "Submit the new objects and steps for the open slide.",
    "input_schema": EDIT_SCHEMA,
}


def slide_problems(slide: Any) -> list[str]:
    return [f"{'/'.join(map(str, e.path)) or 'slide'}: {e.message[:160]}" for e in _slide_validator.iter_errors(slide)][:12]


def edit_problems(patch: Any, slide: dict | None, existing: set[str]) -> list[str]:
    """Schema errors in a slides.edit patch, ids that are not new, and (when the slide JSON is known) the merged slide."""
    problems = [f"{'/'.join(map(str, e.path)) or 'patch'}: {e.message[:160]}" for e in _edit_validator.iter_errors(patch)]
    if problems:
        return problems[:12]
    ids = [o["id"] for o in patch["objects"]]
    if taken := sorted({i for i in ids if i in existing or ids.count(i) > 1}):
        return [f"object ids must be new and unique on this slide: {', '.join(taken)}"]
    if slide:  # the slide's own limits (objects, steps) apply to the result
        return slide_problems({**slide, "objects": slide["objects"] + patch["objects"],
                               "steps": (slide.get("steps") or []) + patch["steps"]})
    return []


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
        lines += [f"{k.capitalize()}: {cur[k]}" for k in ("idea", "check") if cur.get(k)]
        lines += [f"step {i}: {n}" for i, n in enumerate(cur["narration"], 1)]
    return "\n".join(lines)


SPEAK_WAIT_S = 20.0  # how long a ready follow-up waits for the tutor to finish their sentence
STEP_WAIT_MAX_S = 6.0  # slide_step waits for its animation (reply "ms") so speech and picture stay together


async def _note(ctx: RunContext | None, text: str, speak: str | None = None) -> None:
    """Tell the tutor (chat context) that something happened in the background; speak up once nobody is talking."""
    if ctx is None:
        return
    session = ctx.session
    agent = session.current_agent
    chat = agent.chat_ctx.copy()
    chat.add_message(role="system", content=text)
    await agent.update_chat_ctx(chat)
    if not speak:
        return
    # A visual usually lands mid-sentence; a prompt dropped then would leave it unpresented forever.
    for _ in range(int(SPEAK_WAIT_S / 0.25)):
        if session.agent_state == "listening" and session.user_state != "speaking":
            session.generate_reply(instructions=speak)
            return
        await asyncio.sleep(0.25)
    logger.info("follow-up slide: tutor stayed busy; not prompting")


class SlideTools:
    def __init__(self, io, lesson_id: str, client=None, timeout_s: float = 60.0, lesson=None):
        self.io = io
        self.lesson_id = lesson_id
        self.client = client  # anthropic.AsyncAnthropic-like; created lazily (tests inject a fake)
        self.timeout_s = timeout_s
        self.lesson = lesson  # lesson_state.LessonState (or None): told whenever the open slide/step changes
        self.narration: list[str] = []  # step hints of the open slide, from the last describe
        self.index: int | None = None
        self.idea = self.check = ""  # the open slide's lesson plan, from the last describe
        self._tasks: set[asyncio.Task] = set()

    async def _rpc(self, method: str, payload: dict) -> dict:
        try:
            return await self.io.rpc(method, payload)
        except Exception as e:
            return {"ok": False, "errors": [f"slides unreachable: {e}"]}

    async def describe(self) -> str:
        d = await self._rpc("slides.describe", {})
        if d.get("ok") is not False:
            cur = d.get("current") or {}
            self.narration = cur.get("narration") or []
            self.idea, self.check = cur.get("idea") or "", cur.get("check") or ""
            self.index = d.get("index")
            self._note_slide(self.index, d.get("step", 0))
        return outline_text(d)

    def _note_slide(self, index: int | None, step: int) -> None:
        if self.lesson is None or index is None:
            return
        try:
            self.lesson.note_slide(int(index), int(step), self.idea)
        except Exception:
            logger.exception("lesson.note_slide failed")

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
        ms = reply.get("ms")
        if isinstance(ms, (int, float)) and ms > 0:
            await asyncio.sleep(min(ms / 1000, STEP_WAIT_MAX_S))
        index = reply.get("index") or self.index
        self._note_slide(index, step)
        total = len(self.narration)
        if step < total:
            nxt = f" Next: {self.narration[step]} (2-3 short sentences, then slide_step({step + 1}))."
        else:
            q = f'its check question "{self.check}"' if self.check else "a short check question on its idea"
            nxt = f" That was the last step of this slide: ask {q} and wait for the answer before slide_go."
        return f"ok: slide {index}, step {step} of {total or '?'}.{nxt}"

    async def slide_point(self, object_id: str) -> str:
        return self._failed(await self._rpc("slides.point", {"id": object_id})) or f"ok: pointing at {object_id}"

    async def clear_circle(self, circle_id: str) -> str:
        reply = await self._rpc("ui.clear_circle", {"circle_id": circle_id})
        return self._failed(reply) or f"ok: circle {circle_id} cleared"

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        task.add_done_callback(lambda t: t.cancelled() and logger.warning("background slide task was cancelled"))

    async def slide_edit(self, brief: str, object_ids: list[str] | None = None, ctx: RunContext | None = None) -> str:
        self._spawn(self._edit(brief, object_ids or [], ctx))
        return ("queued: adding your explanation to the open slide; a note lists its new steps in a few seconds. "
                "Meanwhile say one short sentence about the idea; do not describe the new drawing until the note says "
                "it is on the slide.")

    async def slide_animate(self, brief: str, object_ids: list[str] | None = None, ctx: RunContext | None = None) -> str:
        self._spawn(self._animate(brief, object_ids or [], ctx))
        return ("queued: building the follow-up animation; it opens on the Slides tab by itself in about 10-20 seconds. "
                "Meanwhile talk about the idea itself; do not describe the animation until a note says it is on screen.")

    async def _plan(self, system: str, tool: dict, messages: list) -> tuple[Any, Any]:
        if self.client is None:
            import anthropic

            self.client = anthropic.AsyncAnthropic()  # ANTHROPIC_API_KEY from env
        resp = await asyncio.wait_for(
            self.client.messages.create(
                model=MODEL, max_tokens=6000, system=system, tools=[tool],
                # Sonnet 5.5 rejects a forced tool_choice; the system prompt names the tool. No thinking: it must land in seconds.
                tool_choice={"type": "auto"}, thinking={"type": "between_tools"}, messages=messages,
            ),
            self.timeout_s,
        )
        use = next(b for b in resp.content if b.type == "tool_use")
        return resp, use

    async def _generate(self, what: str, system: str, tool: dict, prompt: str, problems_of, method: str,
                        payload_of) -> tuple[dict, dict] | None:
        """Plan with Sonnet, validate, send to the page; one retry with the errors. Returns (planned, reply) or None."""
        messages: list = [{"role": "user", "content": prompt}]
        for attempt in range(2):
            resp, use = await self._plan(system, tool, messages)
            logger.info("%s: attempt %d planned", what, attempt + 1)
            out = use.input
            problems = problems_of(out)
            if not problems and len(json.dumps(out)) > RPC_LIMIT:
                problems = [f"the JSON is over {RPC_LIMIT} bytes; use fewer objects, points and path iterates"]
            if not problems:
                reply = await self._rpc(method, payload_of(out))
                logger.info("%s: %s replied %s", what, method, str(reply)[:120])
                if reply.get("ok"):
                    return out, reply
                problems = [str(e) for e in reply.get("errors") or ["the page rejected it"]]
            logger.info("%s attempt %d rejected: %s", what, attempt + 1, problems)
            messages += [
                {"role": "assistant", "content": resp.content},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": use.id, "is_error": True,
                                              "content": f"Fix and call {tool['name']} again:\n" + "\n".join(problems)}]},
            ]
        return None

    @staticmethod
    async def _tell(what: str, ctx: RunContext | None, note: str, speak: str | None) -> None:
        try:
            logger.info("%s: telling the tutor (%s)", what, "ready" if speak else "unavailable")
            await _note(ctx, note, speak)
        except Exception:
            logger.exception("%s: note failed", what)

    async def _animate(self, brief: str, object_ids: list[str], ctx: RunContext | None) -> None:
        note = f"Follow-up animation unavailable: {brief}. Explain it in words or on the board instead."
        speak = None
        try:
            d = await self._rpc("slides.describe", {"slide": True})
            context = json.dumps(d.get("slide")) if d.get("slide") else outline_text(d)
            prompt = (f"The student asked about: {brief}\nCircled objects: {', '.join(object_ids) or 'none'}\n\n"
                      f"The open slide:\n{context}")
            done = await self._generate("follow-up slide", FOLLOWUP_SYSTEM, SLIDE_TOOL, prompt, slide_problems,
                                        "slides.push", lambda slide: {"slide": slide})
            if done:
                slide, reply = done
                steps = slide.get("steps") or []
                hints = "; ".join(f"step {i}: {s.get('narration', '')}" for i, s in enumerate(steps, 1))
                note = (f"Follow-up animation is on screen now as slide {reply.get('index')} "
                        f"\"{slide.get('title')}\" ({len(steps)} steps; {hints}). Walk the student through it with slide_step.")
                speak = "Your follow-up animation just opened on the Slides tab. Introduce it in one sentence, then play step 1."
                await self.describe()
        except Exception:
            logger.exception("follow-up slide failed")
        await self._tell("follow-up slide", ctx, note, speak)

    async def _edit(self, brief: str, object_ids: list[str], ctx: RunContext | None) -> None:
        note = (f"Adding to the slide failed: {brief}. Explain it in words on this slide (slide_point at its parts) "
                "or on the board instead.")
        speak = None
        try:
            d = await self._rpc("slides.describe", {"slide": True})
            slide, cur = d.get("slide"), d.get("current") or {}
            existing = {o["id"] for o in (slide or cur).get("objects") or []}
            before = len(slide.get("steps") or []) if slide else len(cur.get("narration") or [])
            context = json.dumps(slide) if slide else outline_text(d)
            prompt = (f"The student asked about: {brief}\nCircled objects: {', '.join(object_ids) or 'none'}\n\n"
                      f"The open slide (shown up to step {d.get('step', '?')}):\n{context}")
            done = await self._generate("slide edit", EDIT_SYSTEM, EDIT_TOOL, prompt,
                                        lambda p: edit_problems(p, slide, existing), "slides.edit", lambda p: p)
            if done:
                patch, reply = done
                steps = patch["steps"]
                # the page inserts them right after the current step and says where; appended is the fallback
                nums = reply.get("new_steps") or list(range(before + 1, before + len(steps) + 1))
                first, last = nums[0], nums[-1]
                hints = "; ".join(f"step {n}: {s.get('narration', '')}" for n, s in zip(nums, steps))
                note = (f"Your explanation is on the open slide now as new steps {first}-{last} ({hints}). Walk the "
                        f"student through them: 2-3 short sentences each, slide_step({first}) up to slide_step({last}), "
                        "then ask if that helped.")
                speak = f"The new steps are on the slide. Say one short sentence, then slide_step({first})."
                await self.describe()
        except Exception:
            logger.exception("slide edit failed")
        await self._tell("slide edit", ctx, note, speak)

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
            """Build a NEW follow-up animation slide (background, a few seconds; it opens by itself). Only for an idea that is not on the open slide; otherwise use slide_edit.

            Args:
                brief: one or two sentences: what to show and what the student is confused about
                object_ids: ids of the circled objects on the open slide, or []
            """
            return await t.slide_animate(brief, object_ids, context)

        @llm.function_tool
        async def slide_edit(context: RunContext, brief: str, object_ids: list[str]) -> str:
            """Explain something ON the open slide: adds worked numbers, labels or highlights to it as new steps \
(background, a few seconds; a note then tells you which steps to play). Prefer this over slide_animate.

            Args:
                brief: one or two sentences: what to show and what the student is confused about
                object_ids: ids of the circled or discussed objects on the open slide, or []
            """
            return await t.slide_edit(brief, object_ids, context)

        @llm.function_tool
        async def clear_circle(circle_id: str) -> str:
            """Remove the student's circle mark (slides or whiteboard) once they said your explanation helped.

            Args:
                circle_id: the circle_id from the [circled ...] message
            """
            return await t.clear_circle(circle_id)

        return [show_tab, slide_go, slide_step, slide_point, slide_edit, slide_animate, clear_circle]


def slide_tools(io, lesson_id: str, lesson=None) -> list[llm.FunctionTool | llm.RawFunctionTool]:
    """Function tools for the deck and the stage tabs (show_tab, slide navigation, slide pointer, in-place edits,
    follow-up animation, clearing the student's circle). `lesson` (lesson_state.LessonState) is told about slide/step changes."""
    return SlideTools(io, lesson_id, lesson=lesson).function_tools()
