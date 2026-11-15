import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace

import prompting
import slides
from slides import SlideTools, explain_problems, object_text, outline_text, slide_problems, step_objects

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
    for name in ("show_tab", "slide_step", "slide_point", "slide_go", "slide_animate", "slide_explain", "explain_step",
                 "close_explanation", "clear_circle"):
        assert name in slides.RULES
    ctx = json.loads((Path(__file__).parent / "fixtures/context.json").read_text())
    assert slides.RULES in prompting.build_instructions(ctx)


def test_tool_names_are_the_shared_contract():
    names = [t.info.name for t in slides.slide_tools(FakeIO(), "L1")]
    assert names == ["show_tab", "slide_go", "slide_step", "slide_point", "slide_explain", "explain_step",
                     "close_explanation", "slide_animate", "clear_circle"]


def test_rules_follow_the_teaching_contract():
    r = slides.RULES
    assert "bridge" in r and "We just saw" in r  # bridge into every slide
    assert "1-2 short sentences" in r and "[[" in r and "what they think will happen" in r  # pace + predict before reveal
    assert "check question and wait" in r  # check before slide_go
    assert r.index("slide_explain") < r.index("slide_animate") and "Never jump to a new slide" in r
    assert "pop-up" in r and "close_explanation()" in r and "slide_edit" not in r  # v3.2 G2: the slide stays as it is
    assert "lines, curves and arrows" in r and "lists the objects that step shows" in r  # v3.2 G1: denser tags


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
                                           "(1-2 short sentences, then slide_step(2)).")
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


def test_step_wait_ends_before_the_animation_so_the_next_reply_overlaps_it():
    assert slides.animation_wait(4000) == 4.0 - slides.REPLY_LEAD_S
    assert slides.animation_wait(1000) == 0.0  # short steps: no wait at all
    assert slides.animation_wait(60000) == slides.STEP_WAIT_MAX_S - slides.REPLY_LEAD_S
    assert slides.animation_wait(None) == 0.0 and slides.animation_wait(-5) == 0.0


def test_step_waits_for_its_animation_capped(monkeypatch):
    monkeypatch.setattr(slides, "REPLY_LEAD_S", 0.0)
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


EXPLANATION = {
    "id": "why3", "title": "Why the slope is 3",
    "objects": [
        {"kind": "axes", "id": "ex_ax", "x": 150, "y": 200, "w": 900, "h": 600, "x_range": [0, 3], "y_range": [0, 6]},
        {"kind": "shape", "id": "ex_run", "shape": "line", "x": 1, "y": 1, "w": 1, "h": 0, "axes": "ex_ax", "color": "blue"},
        {"kind": "math", "id": "ex_num", "latex": "\\frac{3}{1} = 3", "x": 1300, "y": 400, "size": 60, "color": "yellow"},
    ],
    "steps": [
        {"narration": "this is the tangent you circled", "actions": [{"do": "show", "ids": ["ex_ax", "ex_run"]}]},
        {"narration": "rise 3 over run 1 is 3", "actions": [{"do": "show", "ids": ["ex_num"]}, {"do": "indicate", "ids": ["ex_run"]}]},
    ],
}


def test_explain_problems_keeps_the_pop_up_small_and_its_ids_new():
    taken = {o["id"] for o in DECK["slides"][2]["objects"]}
    assert explain_problems(EXPLANATION, taken) == []
    assert explain_problems({**EXPLANATION, "steps": EXPLANATION["steps"][:1]}, taken)  # 2-5 steps
    assert explain_problems({**EXPLANATION, "steps": EXPLANATION["steps"] * 3}, taken)
    big = {**EXPLANATION, "objects": EXPLANATION["objects"] + [{**EXPLANATION["objects"][2], "id": f"m{i}"} for i in range(8)]}
    assert explain_problems(big, taken)  # <= 10 objects
    assert explain_problems({k: v for k, v in EXPLANATION.items() if k != "steps"}, taken)
    clash = {**EXPLANATION, "objects": [{**EXPLANATION["objects"][0], "id": "tan"}, *EXPLANATION["objects"][1:]]}
    assert explain_problems(clash, taken) == ["object ids must not be on the open slide: tan"]


def test_explain_plans_validates_opens_the_pop_up_and_tells_the_tutor():
    sent = []

    def explain(p):
        sent.append(p)
        return {"ok": True, "errors": []}

    io = FakeIO({"slides.describe": {**DESCRIBE, "slide": DECK["slides"][2]}, "slides.explain": explain})
    client = FakeAnthropic(EXPLANATION)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx()

    async def run():
        out = await t.slide_explain("why the slope is 3 here", ["tan"], ctx)
        assert out.startswith("queued") and "pop-up" in out
        await drain(t)

    asyncio.run(run())
    call = client.calls[0]
    assert call["model"] == "claude-sonnet-5-5" and call["tool_choice"] == {"type": "auto"}
    assert call["thinking"] == {"type": "between_tools"}
    assert call["tools"][0]["name"] == "make_explanation" and "make_explanation" in call["system"]
    assert "pop-up" in call["system"] and "Concrete" in call["system"] and "at most 10 objects" in call["system"]
    prompt = call["messages"][0]["content"]
    assert '"id": "tan"' in prompt and "why the slope is 3 here" in prompt and "Circled objects: tan" in prompt
    # the page builds clip ids from the slide id, so the pop-up never reuses the open slide's id
    [payload] = sent
    assert payload["slide"]["id"].startswith("explain-") and payload["slide"]["id"] != DECK["slides"][2]["id"]
    assert {**payload["slide"], "id": EXPLANATION["id"]} == EXPLANATION
    assert not any(m == "slides.edit" for m, _ in io.rpcs)  # the open slide is never edited
    note = ctx.notes[0]
    assert "pop-up" in note and "2 steps" in note and "step 1: this is the tangent you circled" in note
    assert "ex_run (line)" in note and "ex_num (math" in note  # its object ids, so the tutor can tag them
    assert "explain_step(1)" in note and "close_explanation()" in note and "helped" in note
    assert ctx.replies and "explain_step(1)" in ctx.replies[0]
    assert t.explanation == EXPLANATION


async def test_slide_explain_clears_the_slide_circle_as_the_explanation_starts():
    from circle import PendingCircle

    io = FakeIO({"slides.describe": {"ok": False, "errors": ["x"]}})
    circle = PendingCircle(io)
    circle.open({"circle_id": "k1", "source": "slide"})
    t = SlideTools(io, "L1", client=FakeAnthropic(), circle=circle)
    out = await t.slide_explain("why the slope is 3", ["tan"])
    assert io.rpcs[0] == ("ui.clear_circle", {"circle_id": "k1"})  # before the explanation is even planned
    assert "circle is cleared" in out
    assert "circle" not in await t.slide_explain("again", [])  # nothing left to clear
    for task in list(t._tasks):
        task.cancel()


def test_clear_circle_tool_forgets_the_pending_circle():
    from circle import PendingCircle

    io = FakeIO()
    circle = PendingCircle(io)
    circle.open({"circle_id": "k1", "source": "slide"})
    asyncio.run(SlideTools(io, "L1", circle=circle).clear_circle("k1"))
    assert circle.id is None


def test_explain_retries_with_errors_then_falls_back_to_words():
    clash = {**EXPLANATION, "objects": [{**EXPLANATION["objects"][0], "id": "tan"}, *EXPLANATION["objects"][1:]]}
    io = FakeIO({"slides.describe": {**DESCRIBE, "slide": DECK["slides"][2]},
                 "slides.explain": {"ok": False, "errors": ["step 2 shows zz, which is not on this slide"]}})
    client = FakeAnthropic(clash, EXPLANATION)
    t = SlideTools(io, "L1", client=client)
    ctx = FakeCtx(agent_state="speaking")

    async def run():
        await t.slide_explain("more", [], ctx)
        await drain(t)

    asyncio.run(run())
    assert len(client.calls) == 2
    feedback = client.calls[1]["messages"][-1]["content"][0]
    assert feedback["tool_use_id"] == "tu1" and "make_explanation" in feedback["content"] and "tan" in feedback["content"]
    assert [m for m, _ in io.rpcs].count("slides.explain") == 1  # the clash never reached the page
    assert "failed" in ctx.notes[0] and "in words" in ctx.notes[0] and ctx.replies == []
    assert t.explanation is None


def test_explain_without_slide_json_checks_ids_against_the_outline():
    io = FakeIO({"slides.describe": DESCRIBE, "slides.explain": {"ok": True, "errors": []}})
    clash = {**EXPLANATION, "objects": [{**EXPLANATION["objects"][0], "id": "p"}, *EXPLANATION["objects"][1:]]}
    client = FakeAnthropic(clash, EXPLANATION)
    t = SlideTools(io, "L1", client=client)

    async def run():
        await t.slide_explain("x", [], FakeCtx())
        await drain(t)

    asyncio.run(run())
    assert "not be on the open slide: p" in client.calls[1]["messages"][-1]["content"][0]["content"]


def test_explain_steps_wait_list_their_objects_and_close_back_to_the_slide(monkeypatch):
    waits = []

    async def fake_sleep(s):
        waits.append(s)

    io = FakeIO({"slides.explain_step": {"ok": True, "errors": [], "ms": 400}, "slides.explain_close": {"ok": True, "errors": []}})
    t = SlideTools(io, "L1")
    t.narration, t.step = ["a", "b", "c"], 1
    t.explanation = EXPLANATION
    monkeypatch.setattr(slides.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(slides, "REPLY_LEAD_S", 0.0)  # this test checks the wait itself, not the overlap
    out = asyncio.run(t.explain_step(1))
    assert io.rpcs[-1] == ("slides.explain_step", {"step": 1}) and waits == [0.4]
    assert out.startswith("ok: explanation step 1 of 2.") and "ex_ax (axes), ex_run (line)" in out
    assert "Next: rise 3 over run 1 is 3" in out and "explain_step(2)" in out
    out = asyncio.run(t.explain_step(2))
    assert "ex_num (math: \\frac{3}{1} = 3), ex_run (line)" in out  # indicate counts too
    assert "last step" in out and "helped" in out and "close_explanation()" in out
    out = asyncio.run(t.close_explanation())
    assert io.rpcs[-1] == ("slides.explain_close", {}) and t.explanation is None
    assert out.startswith("ok") and "Next on the slide: b (then slide_step(2))" in out


def test_explain_failures_are_reported_not_raised():
    io = FakeIO({"slides.explain_step": {"ok": False, "errors": ["no explanation is open"]}})
    assert asyncio.run(SlideTools(io, "L1").explain_step(1)) == "failed: no explanation is open"
    assert asyncio.run(SlideTools(FakeIO(fail=RuntimeError("gone")), "L1").close_explanation()).startswith("failed")


def test_step_reply_lists_the_objects_it_shows_so_the_tutor_can_tag_them():
    slide = DECK["slides"][2]
    io = FakeIO({"slides.describe": {**DESCRIBE, "slide": slide}, "slides.step": {"ok": True, "errors": [], "index": 3}})
    t = SlideTools(io, "L1")
    asyncio.run(t.slide_go(3))
    assert ("slides.describe", {"slide": True}) in io.rpcs
    out = asyncio.run(t.slide_step(2))
    assert "It shows tan (tangent), deriv (math: " in out and "tag each" in out
    shown = step_objects(slide, 4)  # move p, hide neg, show pos: hidden objects are not listed
    assert shown[0] == "p (dot)" and shown[1].startswith("pos (math: {\\frac{dL}{d\\theta}} > 0") and len(shown) == 2
    assert step_objects(None, 1) == [] and step_objects(slide, 99) == []
    assert object_text({"id": "c", "kind": "curve", "expr": "x^2", "label": "loss"}) == "c (curve: loss)"


def test_continue_nudge_only_mid_slide_and_never_after_a_question():
    # live: Haiku ended its turn after step 8 of 11 and the lesson sat silent; the agent nudges it on
    t = SlideTools(FakeIO({"slides.step": {"ok": True, "errors": [], "index": 1}}), "L1")
    t.narration = ["a", "b", "c"]
    assert t.continue_instruction("Here is the curve.") is None  # no step played yet on this slide
    asyncio.run(t.slide_step(1))
    assert "slide_step(2)" in t.continue_instruction("This is the curve.")
    assert t.continue_instruction("What do you think happens next?") is None  # waiting for the student
    asyncio.run(t.slide_step(3))
    assert t.continue_instruction("And that is the gradient.") is None  # slide finished: the check question is next


def test_continue_nudge_walks_an_open_explanation_not_the_slide():
    t = SlideTools(FakeIO(), "L1")
    t.narration, t.step = ["a", "b", "c"], 1
    before = t.progress
    t.explanation = EXPLANATION
    assert t.progress != before
    assert t.continue_instruction("Look at this.") is None  # the ready note starts it with explain_step(1)
    t.explain_at = 1
    nudge = t.continue_instruction("This is the tangent.")
    assert "explain_step(2)" in nudge and "slide_step" not in nudge
    t.explain_at = 2
    assert t.continue_instruction("So the slope is 3.") is None  # last step: "did that help?" comes next


def test_no_slides_reply_sends_the_tutor_to_the_whiteboard():
    out = outline_text({"ok": False, "errors": ["no slides are loaded for this lesson"]})
    assert 'show_tab("board")' in out and "told" in out
    assert "whiteboard" not in outline_text({"ok": False, "errors": ["slides unreachable: timeout"]})


def test_rebuilt_slides_mid_lesson_reset_the_open_slide():
    t = SlideTools(FakeIO(), "L1")
    t.narration, t.index, t.step, t.idea = ["a", "b"], 3, 1, "Slope"
    assert "on the way" in t.slides_changed({"status": "building"})
    assert t.index == 3  # still teaching the old slides meanwhile
    nudge = t.slides_changed({"status": "ready", "slides": 6})
    assert "6 slides" in nudge and 'show_tab("slides")' in nudge
    assert (t.narration, t.index, t.step, t.idea) == ([], None, None, "")
    assert t.slides_changed({"status": "other"}) is None
