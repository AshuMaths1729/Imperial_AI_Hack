"""Presentations: the tutor teaches through a pre-generated animated deck (tools drive the Slides tab). Built in WS-C.

The deck lives on the student's page (loaded from GET /api/tutor/tracks/{id}/deck); every tool here is an RPC to
it (frontend/src/tutor/slides/rpc.ts), so the agent always sees the deck the student sees, including follow-up
slides pushed during the lesson. Indexes are 1-based, as the page reports them.
"""

import asyncio
import json
import logging
import re
import uuid
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
# slides.explain (v3.2 G2): a small slide of its own, shown scaled down in a pop-up beside the untouched open slide
_SLIDE_PROPS = _DECK_SCHEMA["$defs"]["Slide"]["properties"]
EXPLAIN_SCHEMA = {
    **SLIDE_SCHEMA, "required": [*SLIDE_SCHEMA["required"], "steps"],
    "properties": {**_SLIDE_PROPS, "objects": {**_SLIDE_PROPS["objects"], "maxItems": 10},
                   "steps": {**_SLIDE_PROPS["steps"], "minItems": 2, "maxItems": 5}},
}
_explain_validator = Draft202012Validator(EXPLAIN_SCHEMA)

RULES = """Slides (slowly, one idea at a time):
- Right after your greeting, call show_tab("slides"); the result lists the slides and the open slide's idea, check \
question, objects and step hints.
- Open every slide with one bridge sentence from the last one ("We just saw X; now..."), then its question.
- Each step: 1-2 short sentences in your own words from its hint, then slide_step to the next step (it returns when \
the animation has finished and lists the objects that step shows). After each reveal let it land: end your sentence, \
never chain straight on. Tag every object you talk about, lines, curves and arrows too ("the [[tan]] tangent"); \
slide_point only when not speaking. Never read the slide out.
- Once per slide, before a reveal, ask what they think will happen and wait for the answer. Otherwise go on \
through the steps without waiting for the student.
- After the last step, ask the slide's check question and wait. slide_go to the next slide only after a good answer; \
otherwise explain again on this slide.
- A question about the open slide is answered in a pop-up beside it (the slide stays as it is): slide_explain builds \
a small animated explanation in the background and a note lists its steps and objects. Walk it with explain_step(1), \
explain_step(2)... tagging its objects, then ask if that helped; when they say it did, close_explanation() and carry \
on. Never jump to a new slide for it; slide_animate (a new slide) only for an idea that is not on this slide.
- The student's circle clears by itself when slide_explain (or board_write) starts your explanation; only if you \
explain in words alone, call clear_circle(circle_id) as you start.
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

EXPLAIN_SYSTEM = """You design ONE small explanation for a live tutor, shown in a pop-up card beside the open slide \
of an animated deck (3Blue1Brown style). It answers exactly what the student asked; the open slide stays as it is. \
Call make_explanation once.
- Its own picture: redraw only what the answer needs from the open slide (same axes ranges, curves and colours; a \
quantity keeps its colour), with new ids that are not on the open slide.
- The card is small: few, large things (text size 44+, math 52+), at most 10 objects, few words on screen.
- Concrete before abstract: plug in actual numbers the student can check. One idea per step (at most one new term \
or symbol).
- 2 to 5 steps, each with a one-sentence narration hint for the tutor; step 1 shows the part the student asked about.
""" + _CANVAS

SLIDE_TOOL = {
    "name": "make_slide",
    "description": "Submit the follow-up slide.",
    "input_schema": SLIDE_SCHEMA,
}
EXPLAIN_TOOL = {
    "name": "make_explanation",
    "description": "Submit the explanation slide for the pop-up.",
    "input_schema": EXPLAIN_SCHEMA,
}


def slide_problems(slide: Any) -> list[str]:
    return [f"{'/'.join(map(str, e.path)) or 'slide'}: {e.message[:160]}" for e in _slide_validator.iter_errors(slide)][:12]


def explain_problems(slide: Any, taken: set[str]) -> list[str]:
    """Schema errors in an explanation slide (small: <= 10 objects, 2-5 steps) and ids already on the open slide."""
    problems = [f"{'/'.join(map(str, e.path)) or 'slide'}: {e.message[:160]}" for e in _explain_validator.iter_errors(slide)]
    if problems:
        return problems[:12]
    if clash := sorted({o["id"] for o in slide["objects"]} & taken):
        return [f"object ids must not be on the open slide: {', '.join(clash)}"]
    return []


def object_text(o: dict) -> str:
    """'tan (tangent)', 'c (curve: 0.4*(x-0.5)^2)': an object id and what it is, so the tutor can tag it."""
    what = o.get("shape") or o["kind"]
    detail = o.get("label") or o.get("text") or o.get("latex") or o.get("expr") or ""
    detail = re.sub(r"\\(?:text)?colou?r\{[^}]*\}", "", detail)  # colour args say nothing about what it is
    return f"{o['id']} ({what}{': ' + detail[:40] if detail else ''})"


def step_objects(slide: dict | None, step: int) -> list[str]:
    """The objects step `step` (1-based) of `slide` shows or moves, described (empty without the slide JSON)."""
    steps = (slide or {}).get("steps") or []
    if not 1 <= step <= len(steps):
        return []
    objs = {o["id"]: o for o in slide["objects"]}
    ids: list[str] = []
    for a in steps[step - 1]["actions"]:
        if a["do"] != "hide":
            ids += [i for i in a.get("ids") or [a.get("id")] if i in objs and i not in ids]
    return [object_text(objs[i]) for i in ids]


def _shows(slide: dict | None, step: int) -> str:
    objs = step_objects(slide, step)
    return f" It shows {', '.join(objs)}: tag each as you talk about it." if objs else ""


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
    def __init__(self, io, lesson_id: str, client=None, timeout_s: float = 60.0, lesson=None, circle=None):
        self.io = io
        self.lesson_id = lesson_id
        self.client = client  # anthropic.AsyncAnthropic-like; created lazily (tests inject a fake)
        self.timeout_s = timeout_s
        self.lesson = lesson  # lesson_state.LessonState (or None): told whenever the open slide/step changes
        self.circle = circle  # circle.PendingCircle (or None): an explanation on the slide clears the student's circle
        self.narration: list[str] = []  # step hints of the open slide, from the last describe
        self.index: int | None = None
        self.step: int | None = None  # last step shown on the open slide (None until the page tells us)
        self.idea = self.check = ""  # the open slide's lesson plan, from the last describe
        self.slide: dict | None = None  # the open slide's JSON (None when it is too big for the RPC reply)
        self.explanation: dict | None = None  # the open explanation pop-up's slide (v3.2 G2)
        self.explain_at = 0  # last step shown in the pop-up
        self._tasks: set[asyncio.Task] = set()

    async def _rpc(self, method: str, payload: dict) -> dict:
        try:
            return await self.io.rpc(method, payload)
        except Exception as e:
            return {"ok": False, "errors": [f"slides unreachable: {e}"]}

    async def describe(self) -> str:
        d = await self._rpc("slides.describe", {"slide": True})
        if d.get("ok") is not False:
            cur = d.get("current") or {}
            self.slide = d.get("slide")
            self.narration = cur.get("narration") or []
            self.idea, self.check = cur.get("idea") or "", cur.get("check") or ""
            self.index, self.step = d.get("index"), d.get("step", 0)
            self._note_slide(self.index, self.step)
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
        self.explanation = None  # shortcut: assumes the page closes the pop-up with the slide; else close_explanation
        return "ok\n" + await self.describe()

    async def slide_step(self, step: int) -> str:
        reply = await self._rpc("slides.step", {"step": step})
        if err := self._failed(reply):
            return err
        ms = reply.get("ms")
        if isinstance(ms, (int, float)) and ms > 0:
            await asyncio.sleep(min(ms / 1000, STEP_WAIT_MAX_S))
        index = reply.get("index") or self.index
        self.step = step
        self._note_slide(index, step)
        total = len(self.narration)
        if step < total:
            nxt = f" Next: {self.narration[step]} (1-2 short sentences, then slide_step({step + 1}))."
        else:
            q = f'its check question "{self.check}"' if self.check else "a short check question on its idea"
            nxt = f" That was the last step of this slide: ask {q} and wait for the answer before slide_go."
        return f"ok: slide {index}, step {step} of {total or '?'}.{_shows(self.slide, step)}{nxt}"

    @property
    def progress(self) -> tuple:
        """Changes whenever the lesson moves on (a slide step or a pop-up step)."""
        return self.index, self.step, self.explanation is not None, self.explain_at

    def continue_instruction(self, said: str) -> str | None:
        """The voice model sometimes ends its turn mid-slide; the nudge to go on (None when it just asked the student
        something, or the slide / explanation is finished and its question comes next)."""
        if said.rstrip().endswith("?"):
            return None
        if self.explanation is not None:
            steps = self.explanation.get("steps") or []
            if not 0 < self.explain_at < len(steps):
                return None
            n = self.explain_at + 1
            return (f"Continue the explanation: 1-2 short sentences for its step {n} ({steps[n - 1].get('narration', '')}), "
                    f"then explain_step({n}).")
        if self.step is None or self.step >= len(self.narration):
            return None
        n = self.step + 1
        return f"Continue the slide: 1-2 short sentences for step {n} ({self.narration[n - 1]}), then slide_step({n})."

    async def slide_point(self, object_id: str) -> str:
        return self._failed(await self._rpc("slides.point", {"id": object_id})) or f"ok: pointing at {object_id}"

    async def clear_circle(self, circle_id: str) -> str:
        reply = await self._rpc("ui.clear_circle", {"circle_id": circle_id})
        if self.circle is not None and self.circle.id == circle_id:
            self.circle.id = None
        return self._failed(reply) or f"ok: circle {circle_id} cleared"

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        task.add_done_callback(lambda t: t.cancelled() and logger.warning("background slide task was cancelled"))

    async def _clear_circle(self) -> str:
        """The explanation starts: the student's circle on the slide goes (v3.1 F2)."""
        cleared = self.circle is not None and await self.circle.clear("slide")
        return " The student's circle is cleared." if cleared else ""

    async def slide_explain(self, brief: str, object_ids: list[str] | None = None, ctx: RunContext | None = None) -> str:
        cleared = await self._clear_circle()
        self._spawn(self._explain(brief, object_ids or [], ctx))
        return ("queued: building your explanation pop-up beside the slide; a note lists its steps in a few seconds. "
                "Meanwhile say one short sentence about the idea; do not describe the drawing until the note says it "
                "is open." + cleared)

    async def explain_step(self, step: int) -> str:
        reply = await self._rpc("slides.explain_step", {"step": step})
        if err := self._failed(reply):
            return err
        ms = reply.get("ms")
        if isinstance(ms, (int, float)) and ms > 0:
            await asyncio.sleep(min(ms / 1000, STEP_WAIT_MAX_S))
        self.explain_at = step
        steps = (self.explanation or {}).get("steps") or []
        if step < len(steps):
            nxt = f" Next: {steps[step].get('narration', '')} (1-2 short sentences, then explain_step({step + 1}))."
        else:
            nxt = (" That was its last step: ask if that helped and wait. When they say it did, close_explanation() "
                   "and carry on with the slide.")
        return f"ok: explanation step {step} of {len(steps) or '?'}.{_shows(self.explanation, step)}{nxt}"

    async def close_explanation(self) -> str:
        if err := self._failed(await self._rpc("slides.explain_close", {})):
            return err
        self.explanation, self.explain_at = None, 0
        if self.step is not None and self.step < len(self.narration):
            back = f" Next on the slide: {self.narration[self.step]} (then slide_step({self.step + 1}))."
        else:
            back = " Carry on with the slide's check question."
        return "ok: the explanation is closed." + back

    async def slide_animate(self, brief: str, object_ids: list[str] | None = None, ctx: RunContext | None = None) -> str:
        cleared = await self._clear_circle()
        self._spawn(self._animate(brief, object_ids or [], ctx))
        return ("queued: building the follow-up animation; it opens on the Slides tab by itself in about 10-20 seconds. "
                "Meanwhile talk about the idea itself; do not describe the animation until a note says it is on screen." + cleared)

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

    async def _explain(self, brief: str, object_ids: list[str], ctx: RunContext | None) -> None:
        note = (f"The explanation pop-up failed: {brief}. Explain it in words on this slide (tag its parts with [[id]]) "
                "or on the board instead.")
        speak = None
        try:
            d = await self._rpc("slides.describe", {"slide": True})
            slide, cur = d.get("slide"), d.get("current") or {}
            taken = {o["id"] for o in (slide or cur).get("objects") or []}
            context = json.dumps(slide) if slide else outline_text(d)
            prompt = (f"The student asked about: {brief}\nCircled objects: {', '.join(object_ids) or 'none'}\n\n"
                      f"The open slide (shown up to step {d.get('step', '?')}):\n{context}")
            done = await self._generate("explanation", EXPLAIN_SYSTEM, EXPLAIN_TOOL, prompt,
                                        lambda e: explain_problems(e, taken), "slides.explain",
                                        # its own id: the page derives clip ids from it, so it must never clash with the slide's
                                        lambda e: {"slide": {**e, "id": f"explain-{uuid.uuid4().hex[:8]}"}})
            if done:
                exp, _ = done
                self.explanation, self.explain_at = exp, 0
                steps = exp["steps"]
                hints = "; ".join(f"step {i}: {s.get('narration', '')}" for i, s in enumerate(steps, 1))
                objs = ", ".join(object_text(o) for o in exp["objects"])
                note = (f"Your explanation is open in a pop-up beside the slide: \"{exp.get('title')}\" ({len(steps)} "
                        f"steps; {hints}). Its objects: {objs}. Walk the student through it: 1-2 short sentences each, "
                        f"explain_step(1) up to explain_step({len(steps)}), tagging its objects as you talk, then ask if "
                        "that helped. When they say it did, close_explanation() and carry on with the slide.")
                speak = "Your explanation pop-up is open. Say one short sentence, then explain_step(1)."
        except Exception:
            logger.exception("explanation failed")
        await self._tell("explanation", ctx, note, speak)

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
        async def slide_explain(context: RunContext, brief: str, object_ids: list[str]) -> str:
            """Answer a question about the open slide in a small animated explanation pop-up beside it (the slide \
stays as it is). Builds in the background (a few seconds); a note then lists its steps and objects. Prefer this over \
slide_animate.

            Args:
                brief: one or two sentences: what to show and what the student is confused about
                object_ids: ids of the circled or discussed objects on the open slide, or []
            """
            return await t.slide_explain(brief, object_ids, context)

        @llm.function_tool
        async def explain_step(step: int) -> str:
            """Play the open explanation pop-up up to `step` (1 = its first step); returns when the animation has finished.

            Args:
                step: step number in the explanation, normally the next one
            """
            return await t.explain_step(step)

        @llm.function_tool
        async def close_explanation() -> str:
            """Close the explanation pop-up once the student says it helped, then carry on with the slide."""
            return await t.close_explanation()

        @llm.function_tool
        async def slide_animate(context: RunContext, brief: str, object_ids: list[str]) -> str:
            """Build a NEW follow-up animation slide (background, a few seconds; it opens by itself). Only for an idea that is not on the open slide; otherwise use slide_explain.

            Args:
                brief: one or two sentences: what to show and what the student is confused about
                object_ids: ids of the circled objects on the open slide, or []
            """
            return await t.slide_animate(brief, object_ids, context)

        @llm.function_tool
        async def clear_circle(circle_id: str) -> str:
            """Remove the student's circle mark. Only needed when you explain in words alone: slide_explain and board_write clear it themselves.

            Args:
                circle_id: the circle_id from the [circled ...] message
            """
            return await t.clear_circle(circle_id)

        return [show_tab, slide_go, slide_step, slide_point, slide_explain, explain_step, close_explanation, slide_animate,
                clear_circle]


def slide_tools(io, lesson_id: str, lesson=None) -> list[llm.FunctionTool | llm.RawFunctionTool]:
    """Function tools for the deck and the stage tabs (show_tab, slide navigation, slide pointer, explanation pop-up,
    follow-up animation, clearing the student's circle). `lesson` (lesson_state.LessonState) is told about slide/step changes."""
    return SlideTools(io, lesson_id, lesson=lesson).function_tools()  # agent.py builds SlideTools itself (needs the instance)
