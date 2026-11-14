import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace

import prompting
import slides
from slides import SlideTools, edit_problems, outline_text, slide_problems

DECK = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/tutor/slides/decks/gradient-descent.json").read_text())

DESCRIBE = {
    "ok": True, "index": 3, "step": 1,
    "slides": [
        {"index": 1, "id": "landscape", "title": "Lost in the fog", "kp_ids": ["gd1"], "steps": 4},
        {"index": 3, "id": "gradient", "title": "The slope points uphill", "kp_ids": ["gd2"], "steps": 5},
        {"index": 4, "id": "extra", "title": "Slope up close", "kp_ids": [], "steps": 3, "followup": True},
    ],
    "current": {"id": "gradient", "title": "The slope points uphill",
                "objects": [{"id": "tan", "kind": "tangent"}, {"id": "p", "kind": "dot", "label": "you"}],
                "narration": ["feel the ground", "the tangent is the slope", "negative here"]},
}


class FakeIO:
    def __init__(self, replies=None, fail=None):
        self.replies = replies or {}
        self.fail = fail
        self.rpcs: list[tuple[str, dict]] = []

    async def rpc(self, method, payload):
        self.rpcs.append((method, payload))
        if self.fail:
            raise self.fail
        r = self.replies.get(method, {"ok": True, "errors": []})
        return r(payload) if callable(r) else r


SLIDE = {
    "id": "slope_zoom", "title": "Slope up close", "kp_ids": ["gd2"],
    "objects": [
        {"kind": "axes", "id": "ax", "x": 200, "y": 200, "w": 1000, "h": 560, "x_range": [-3, 3], "y_range": [0, 6]},
        {"kind": "curve", "id": "c", "axes": "ax", "expr": "a*(x-0.5)^2+0.5"},
        {"kind": "slider", "id": "s", "param": "a", "min": 0.1, "max": 1, "value": 0.4, "x": 1250, "y": 400},
    ],
    "steps": [{"narration": "drag it", "actions": [{"do": "show", "ids": ["ax", "c"]}]}],
}


class FakeAnthropic:
    def __init__(self, *inputs, delay=0):
        self.inputs = list(inputs)
        self.calls: list[dict] = []
        self.delay = delay
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kw):
        self.calls.append({**kw, "messages": list(kw["messages"])})  # the caller keeps appending to its list
        await asyncio.sleep(self.delay)
        block = SimpleNamespace(type="tool_use", id=f"tu{len(self.calls)}", input=self.inputs.pop(0))
        return SimpleNamespace(content=[block])


class FakeCtx:
    def __init__(self, agent_state="listening", user_state="listening"):
        self.notes: list[str] = []
        self.replies: list[str] = []
        ctx = self

        class Chat:
            def copy(self):
                return self

            def add_message(self, role, content):
                ctx.notes.append(content)

        async def update_chat_ctx(_):
            pass

        self.session = SimpleNamespace(
            current_agent=SimpleNamespace(chat_ctx=Chat(), update_chat_ctx=update_chat_ctx),
            agent_state=agent_state, user_state=user_state,
            generate_reply=lambda instructions: self.replies.append(instructions),
        )


async def drain(t: SlideTools):
    await asyncio.gather(*list(t._tasks))


def test_rules_are_in_the_system_prompt_and_name_the_shared_tools():
    for name in ("show_tab", "slide_step", "slide_point", "slide_go", "slide_animate", "slide_edit", "clear_circle"):
        assert name in slides.RULES
    ctx = json.loads((Path(__file__).parent / "fixtures/context.json").read_text())
    assert slides.RULES in prompting.build_instructions(ctx)


def test_tool_names_are_the_shared_contract():
    names = [t.info.name for t in slides.slide_tools(FakeIO(), "L1")]
    assert names == ["show_tab", "slide_go", "slide_step", "slide_point", "slide_edit", "slide_animate", "clear_circle"]


def test_rules_follow_the_teaching_contract():
    r = slides.RULES
    assert "bridge" in r and "We just saw" in r  # bridge into every slide
    assert "2-3 short sentences" in r and "what they think will happen" in r  # pace + predict before reveal
    assert "check question and wait" in r  # check before slide_go
    assert r.index("slide_edit") < r.index("slide_animate") and "Never jump to a new slide" in r


def test_outline_text_lists_slides_objects_and_hints():
    text = outline_text(DESCRIBE)
    assert "slide 3 of 3 is open, at step 1" in text
    assert "3. The slope points uphill [gd2], 5 steps  <- open" in text
    assert "(follow-up)" in text
    assert "tan (tangent), p (dot: you)" in text
    assert "step 2: the tangent is the slope" in text
    assert "Idea:" not in text  # only when the deck has a lesson plan
    planned = {**DESCRIBE, "current": {**DESCRIBE["current"], "idea": "the slope is the tangent", "check": "which way is downhill?"}}
    assert "Idea: the slope is the tangent\nCheck: which way is downhill?" in outline_text(planned)
    assert outline_text({"ok": False, "errors": ["no slides are loaded"]}).startswith("couldn't read the slides: no slides")


def test_show_tab_slides_returns_outline():
    io = FakeIO({"slides.describe": DESCRIBE})
    out = asyncio.run(SlideTools(io, "L1").show_tab("slides"))
    assert io.rpcs[0] == ("ui.show_tab", {"tab": "slides"})
    assert "Lost in the fog" in out
    out = asyncio.run(SlideTools(FakeIO(), "L1").show_tab("board"))
    assert out == "ok: showing the whiteboard"


def test_go_then_step_reports_the_next_hint():
    io = FakeIO({"slides.describe": DESCRIBE, "slides.step": lambda p: {"ok": True, "errors": [], "index": 3, "step": p["step"]}})
    t = SlideTools(io, "L1")
    assert asyncio.run(t.slide_go(3)).startswith("ok\nDeck:")
    assert io.rpcs[0] == ("slides.go", {"index": 3})
    assert asyncio.run(t.slide_step(1)) == ("ok: slide 3, step 1 of 3. Next: the tangent is the slope "
                                           "(2-3 short sentences, then slide_step(2)).")
    assert asyncio.run(t.slide_step(3)).endswith(
        "last step of this slide: ask a short check question on its idea and wait for the answer before slide_go.")


class FakeLesson:
    def __init__(self, fail=False):
        self.notes, self.fail = [], fail

    def note_slide(self, index, step, idea=""):
        if self.fail:
            raise RuntimeError("boom")
        self.notes.append((index, step, idea))


PLANNED = {**DESCRIBE, "current": {**DESCRIBE["current"], "idea": "the slope is the tangent", "check": "which way is downhill?"}}


def test_go_and_step_tell_the_lesson_state_and_end_on_the_check_question():
    io = FakeIO({"slides.describe": PLANNED, "slides.step": lambda p: {"ok": True, "errors": [], "index": 3, "step": p["step"]}})
    lesson = FakeLesson()
    t = SlideTools(io, "L1", lesson=lesson)
    asyncio.run(t.slide_go(3))
    out = asyncio.run(t.slide_step(3))
    assert lesson.notes == [(3, 1, "the slope is the tangent"), (3, 3, "the slope is the tangent")]
    assert 'ask its check question "which way is downhill?" and wait for the answer before slide_go' in out
    # a broken lesson state never breaks the slides
    assert asyncio.run(SlideTools(io, "L1", lesson=FakeLesson(fail=True)).slide_step(1)).startswith("ok")


def test_step_waits_for_its_animation_capped(monkeypatch):
    io = FakeIO({"slides.step": lambda p: {"ok": True, "errors": [], "index": 3, "ms": p["step"]}})
    t = SlideTools(io, "L1")
    t0 = time.monotonic()
    asyncio.run(t.slide_step(150))  # ms = 150
    assert time.monotonic() - t0 >= 0.14
    monkeypatch.setattr(slides, "STEP_WAIT_MAX_S", 0.05)
    t0 = time.monotonic()
    asyncio.run(t.slide_step(60000))
    assert time.monotonic() - t0 < 0.5


def test_clear_circle():
    io = FakeIO()
    assert asyncio.run(SlideTools(io, "L1").clear_circle("c7")) == "ok: circle c7 cleared"
    assert io.rpcs == [("ui.clear_circle", {"circle_id": "c7"})]
    bad = FakeIO({"ui.clear_circle": {"ok": False, "errors": ["no circle c9"]}})
    assert asyncio.run(SlideTools(bad, "L1").clear_circle("c9")) == "failed: no circle c9"


def test_failures_are_reported_not_raised():
    io = FakeIO({"slides.step": {"ok": False, "errors": ["step must be 0..4 on this slide"]}})
    assert asyncio.run(SlideTools(io, "L1").slide_step(9)) == "failed: step must be 0..4 on this slide"
    down = SlideTools(FakeIO(fail=RuntimeError("the student's page is not connected")), "L1")
    assert "not connected" in asyncio.run(down.slide_point("tan"))
    assert "not connected" in asyncio.run(down.show_tab("slides"))


def test_point():
    io = FakeIO()
    assert asyncio.run(SlideTools(io, "L1").slide_point("tan")) == "ok: pointing at tan"
    assert io.rpcs == [("slides.point", {"id": "tan"})]


def test_fallback_deck_slides_match_the_agent_schema():
    for s in DECK["slides"]:
        assert slide_problems(s) == [], s["id"]
    assert slide_problems({"id": "x", "title": "t", "objects": [{"kind": "blob", "id": "b"}]})


def test_animate_generates_validates_pushes_and_tells_the_tutor():
    pushed = []

    def push(p):
        pushed.append(p["slide"])
        return {"ok": True, "errors": [], "index": 4, "step": 0}

    io = FakeIO({"slides.describe": {**DESCRIBE, "slide": DECK["slides"][2]}, "slides.push": push})
    client = FakeAnthropic(SLIDE)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx()

    async def run():
        out = await t.slide_animate("why the tangent tilts", ["tan"], ctx)
        assert out.startswith("queued")
        await drain(t)

    asyncio.run(run())
    call = client.calls[0]
    assert call["model"] == "claude-sonnet-5-5" and call["tool_choice"] == {"type": "auto"}
    assert call["thinking"] == {"type": "between_tools"}  # a follow-up must land in seconds
    assert '"id": "tan"' in call["messages"][0]["content"] and "why the tangent tilts" in call["messages"][0]["content"]
    assert pushed == [SLIDE]
    assert "on screen now as slide 4" in ctx.notes[0] and "step 1: drag it" in ctx.notes[0]
    assert ctx.replies and "play step 1" in ctx.replies[0]


def test_animate_retries_with_errors_and_stays_quiet_while_someone_talks():
    bad = {**SLIDE, "objects": [{"kind": "blob", "id": "b"}]}
    replies = iter([{"ok": False, "errors": ["c.axes refers to zz, which is not a axes"]}, {"ok": True, "errors": [], "index": 2}])
    io = FakeIO({"slides.describe": DESCRIBE, "slides.push": lambda p: next(replies)})
    client = FakeAnthropic(bad, SLIDE, SLIDE)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx(agent_state="speaking")

    async def run():
        await t.slide_animate("more", [], ctx)
        await drain(t)

    asyncio.run(run())
    # 1st: schema error (never sent to the page); 2nd: page rejected it -> gives up after 2 attempts
    assert len(client.calls) == 2
    feedback = client.calls[1]["messages"][-1]["content"][0]
    assert feedback["tool_use_id"] == "tu1" and "objects" in feedback["content"]
    assert [m for m, _ in io.rpcs].count("slides.push") == 1
    assert "unavailable" in ctx.notes[0] and ctx.replies == []


def test_ready_slide_is_introduced_once_the_tutor_finishes_talking():
    # live: the slide landed while the tutor was mid-sentence, the prompt was dropped, and nobody ever presented it
    io = FakeIO({"slides.describe": DESCRIBE, "slides.push": {"ok": True, "errors": [], "index": 2}})
    t = SlideTools(io, "L1", client=FakeAnthropic(SLIDE))
    ctx = FakeCtx(agent_state="speaking")

    async def run():
        await t.slide_animate("more", [], ctx)
        await asyncio.sleep(0.3)
        assert ctx.replies == []  # never talks over the tutor
        ctx.session.agent_state = "listening"
        await drain(t)

    asyncio.run(run())
    assert len(ctx.replies) == 1 and "follow-up" in ctx.replies[0]


def test_animate_timeout_tells_the_tutor_it_is_unavailable():
    io = FakeIO({"slides.describe": DESCRIBE})
    t = SlideTools(io, "L1", client=FakeAnthropic(SLIDE, delay=1), timeout_s=0.05)
    ctx = FakeCtx()

    async def run():
        await t.slide_animate("x", [], ctx)
        await drain(t)

    asyncio.run(run())
    assert "unavailable" in ctx.notes[0]
    assert not any(m == "slides.push" for m, _ in io.rpcs)


def test_animate_rejects_slides_too_big_for_an_rpc():
    huge = {**SLIDE, "objects": SLIDE["objects"] + [
        {"kind": "polyline", "id": f"p{i}", "points": [[0, 0]] * 200} for i in range(20)]}
    io = FakeIO({"slides.describe": DESCRIBE})
    client = FakeAnthropic(huge, huge)
    t = SlideTools(io, "L1", client=client)

    async def run():
        await t.slide_animate("x", [], FakeCtx())
        await drain(t)

    asyncio.run(run())
    assert "over 14000 bytes" in client.calls[1]["messages"][-1]["content"][0]["content"]
    assert not any(m == "slides.push" for m, _ in io.rpcs)


PATCH = {
    "objects": [
        {"kind": "math", "id": "slope_num", "latex": "\\text{slope} = 2 \\cdot 1.5 = 3", "x": 1250, "y": 300, "color": "yellow"},
    ],
    "steps": [
        {"narration": "this is the tangent you circled", "actions": [{"do": "indicate", "ids": ["tan"]}]},
        {"narration": "at x = 1.5 the slope is 3", "actions": [{"do": "show", "ids": ["slope_num"]}]},
    ],
}


def test_edit_problems_checks_schema_new_ids_and_the_merged_slide():
    slide = DECK["slides"][2]
    existing = {o["id"] for o in slide["objects"]}
    assert edit_problems(PATCH, slide, existing) == []
    assert edit_problems({"objects": [], "steps": []}, slide, existing)  # at least one step
    assert edit_problems({**PATCH, "objects": [{"kind": "blob", "id": "b"}]}, slide, existing)
    clash = {**PATCH, "objects": [{**PATCH["objects"][0], "id": "tan"}]}
    assert edit_problems(clash, slide, existing) == ["object ids must be new and unique on this slide: tan"]
    full = {**slide, "steps": slide["steps"] * 2}  # 10 steps + 4 new > 12
    many = {**PATCH, "steps": PATCH["steps"] * 2}
    assert any("steps" in e for e in edit_problems(many, full, existing))
    assert edit_problems(PATCH, None, {"ax"}) == []  # slide JSON too big for the RPC: patch checks only


def test_edit_plans_validates_sends_and_names_the_new_steps():
    edits = []

    def edit(p):
        edits.append(p)
        return {"ok": True, "errors": [], "index": 3, "step": 5, "steps_added": 2}

    io = FakeIO({"slides.describe": {**DESCRIBE, "slide": DECK["slides"][2]}, "slides.edit": edit})
    client = FakeAnthropic(PATCH)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx()

    async def run():
        out = await t.slide_edit("why the slope is 3 here", ["tan"], ctx)
        assert out.startswith("queued") and "open slide" in out
        await drain(t)

    asyncio.run(run())
    call = client.calls[0]
    assert call["model"] == "claude-sonnet-5-5" and call["tool_choice"] == {"type": "auto"}
    assert call["thinking"] == {"type": "between_tools"}
    assert call["tools"][0]["name"] == "add_to_slide" and "add_to_slide" in call["system"]
    assert "concrete" in call["system"].lower() and "circled" in call["system"] and "colour" in call["system"]
    prompt = call["messages"][0]["content"]
    assert '"id": "tan"' in prompt and "why the slope is 3 here" in prompt and "Circled objects: tan" in prompt
    assert edits == [PATCH]
    # the slide had 5 steps, so the new ones are 6 and 7
    assert "new steps 6-7" in ctx.notes[0] and "step 6: this is the tangent you circled" in ctx.notes[0]
    assert "slide_step(6)" in ctx.notes[0] and "helped" in ctx.notes[0]
    assert ctx.replies and "slide_step(6)" in ctx.replies[0]


def test_edit_retries_with_errors_then_falls_back_to_words():
    clash = {**PATCH, "objects": [{**PATCH["objects"][0], "id": "tan"}]}
    io = FakeIO({"slides.describe": {**DESCRIBE, "slide": DECK["slides"][2]},
                 "slides.edit": {"ok": False, "errors": ["step 2 shows zz, which is not on this slide"]}})
    client = FakeAnthropic(clash, PATCH)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx(agent_state="speaking")

    async def run():
        await t.slide_edit("more", [], ctx)
        await drain(t)

    asyncio.run(run())
    assert len(client.calls) == 2
    feedback = client.calls[1]["messages"][-1]["content"][0]
    assert feedback["tool_use_id"] == "tu1" and "add_to_slide" in feedback["content"] and "tan" in feedback["content"]
    assert [m for m, _ in io.rpcs].count("slides.edit") == 1  # the clash never reached the page
    assert "failed" in ctx.notes[0] and "in words" in ctx.notes[0] and ctx.replies == []


def test_edit_without_slide_json_uses_the_outline_ids_and_step_count():
    io = FakeIO({"slides.describe": DESCRIBE, "slides.edit": {"ok": True, "errors": []}})
    patch = {**PATCH, "objects": [{**PATCH["objects"][0], "id": "p"}]}  # p is on the slide (outline)
    client = FakeAnthropic(patch, PATCH)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx()

    async def run():
        await t.slide_edit("x", [], ctx)
        await drain(t)

    asyncio.run(run())
    assert "unique on this slide: p" in client.calls[1]["messages"][-1]["content"][0]["content"]
    assert "new steps 4-5" in ctx.notes[0]  # 3 narration hints in the outline
