import json

from livekit.agents import Agent, llm

import lesson_state
from lesson_state import STATE_ID, LessonState


class Post:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    async def __call__(self, path, body):
        if self.fail:
            raise RuntimeError("backend down")
        self.calls.append((path, json.loads(json.dumps(body))))  # must be JSON-serialisable
        return {}


def tools(state):
    return {t.info.name: t for t in state.function_tools()}


async def call(state, name, **kw):
    return await tools(state)[name](**kw)


async def agent_with_history() -> Agent:
    agent = Agent(instructions="x", tools=[])
    chat = llm.ChatContext()
    chat.add_message(role="system", content="You are the tutor.", id="instructions")
    for i in range(6):
        chat.add_message(role="user" if i % 2 else "assistant", content=f"t{i}")
    await agent.update_chat_ctx(chat)
    return agent


def state_items(agent):
    return [i for i in agent.chat_ctx.items if i.id == STATE_ID]


# --- main branch -----------------------------------------------------------------------------------------------

def test_fresh_state_says_to_open_the_slides():
    text = LessonState("L1").context_text()
    assert text.startswith("Lesson state")
    assert 'show_tab("slides")' in text


def test_note_slide_tracks_slide_step_and_idea():
    s = LessonState("L1")
    s.note_slide(3, 1, "A chord joins two points; its gradient is rise over run.")
    s.note_slide(3, 2)  # a step-only update keeps the slide's idea
    text = s.context_text()
    assert "slide 3, step 2" in text and "rise over run" in text
    assert "step 3" in text  # next: continue from the following step
    s.note_slide(4, 0)  # a new slide without an idea clears the old one
    assert "rise over run" not in s.context_text()


# --- side branches ---------------------------------------------------------------------------------------------

async def test_detour_start_and_end_bridge_back_to_the_same_slide_and_step():
    s = LessonState("L1")
    s.note_slide(3, 2, "A chord's gradient is rise over run.")
    out = await call(s, "detour_start", topic="what a limit is", why="student asked")
    assert out.startswith("ok")
    text = s.context_text()
    assert "what a limit is" in text and "detour_end" in text
    s.note_slide(4, 1, "Limits, zoomed in.")  # a follow-up slide opened during the detour
    text = s.context_text()
    assert "Main: slide 3, step 2" in text and "Now: slide 4, step 1" in text
    back = await call(s, "detour_end", resolved=True)
    assert "Back to A chord's gradient is rise over run. on slide 3, step 2" in back
    assert "one sentence" in back and "slide_go(3)" in back  # the deck moved: go back first
    assert s.detours == []


async def test_nested_detours_list_innermost_first_and_pop_in_order():
    s = LessonState("L1")
    s.note_slide(2, 1, "Gradient of a line.")
    await call(s, "detour_start", topic="negative numbers", why="confused")
    s.note_slide(2, 2)
    await call(s, "detour_start", topic="what minus minus is", why="asked")
    text = s.context_text()
    assert text.index("what minus minus is") < text.index("negative numbers")
    back = await call(s, "detour_end", resolved=False)
    assert "slide 2, step 2" in back and "not resolved" in back
    back = await call(s, "detour_end", resolved=True)
    assert "slide 2, step 1" in back and "slide_go" not in back  # same slide: no navigation needed


async def test_detour_end_without_a_detour_is_harmless():
    s = LessonState("L1")
    s.note_slide(1, 1, "Speed right now.")
    out = await call(s, "detour_end", resolved=True)
    assert "no detour" in out.lower() and "slide 1" in out


# --- understanding and anchors ---------------------------------------------------------------------------------

async def test_mark_understanding_and_anchor_show_in_context():
    s = LessonState("L1")
    s.note_slide(3, 2, "Chords.")
    await call(s, "set_anchor", concept="gradient", anchor="the car's speedometer")
    out = await call(s, "mark_understanding", concept="Gradient", level="got_it", evidence="said 2 for y=2x+1")
    assert out.startswith("ok")
    await call(s, "mark_understanding", concept="chord", level="shaky", evidence="mixed up rise and run")
    text = s.context_text()
    assert "gradient: got_it" in text and "speedometer" in text  # same concept despite the capital G
    assert "chord: shaky (mixed up rise and run)" in text
    assert "Next: chord is shaky" in text  # the latest weak mark is the next thing to fix


async def test_shaky_twice_allows_a_new_anchor():
    s = LessonState("L1")
    await call(s, "set_anchor", concept="limit", anchor="zooming in on a map")
    first = await call(s, "mark_understanding", concept="limit", level="not_yet", evidence="no idea")
    assert "zooming in on a map" in first and "new anchor" not in first
    second = await call(s, "mark_understanding", concept="limit", level="shaky", evidence="half")
    assert "new anchor" in second


async def test_invalid_level_is_refused():
    s = LessonState("L1")
    out = await s.mark_understanding("x", "kinda", "")
    assert out.startswith("failed")


def test_tool_names():
    assert set(tools(LessonState("L1"))) == {"detour_start", "detour_end", "mark_understanding", "set_anchor"}


async def test_context_text_stays_compact_in_a_busy_lesson():
    s = LessonState("L1")
    s.note_slide(5, 3, "The limit of the chord's gradient as h shrinks to zero is the gradient of the tangent. " * 3)
    for i in range(12):
        await call(s, "set_anchor", concept=f"concept number {i} with a long name", anchor="a very long analogy " * 6)
        await call(s, "mark_understanding", concept=f"concept number {i} with a long name", level="shaky",
                   evidence="a long piece of evidence " * 6)
    for i in range(5):
        await call(s, "detour_start", topic="a fairly long detour topic name " * 3, why="because " * 10)
    text = s.context_text()
    assert len(text) <= 1000, len(text)
    assert "more" in text  # older detours are summarised, not dropped silently


def test_resume_seeds_concepts_and_anchors():
    prev = {"slide": 4, "step": 2, "idea": "Zoom in.", "detours": [],
            "concepts": [{"concept": "gradient", "level": "got_it", "evidence": "e", "anchor": "speedometer", "tries": 0}]}
    s = LessonState("L2", resume=prev)
    assert "gradient: got_it" in s.context_text() and "speedometer" in s.context_text()
    assert s.slide == 0  # the page opens at slide 1; the tutor navigates there itself


# --- checkpoint --------------------------------------------------------------------------------------------------

async def test_checkpoint_puts_one_state_message_after_the_instructions_and_posts():
    agent, post = await agent_with_history(), Post()
    s = LessonState("L1", post)
    s.note_slide(2, 1, "Gradient of a line.")
    await s.checkpoint(agent)
    s.note_slide(2, 2)
    await s.checkpoint(agent)
    items = agent.chat_ctx.items
    assert items[0].id == "instructions" and items[1].id == STATE_ID
    assert len(state_items(agent)) == 1 and "step 2" in items[1].text_content
    path, body = post.calls[-1]
    assert path == "/api/tutor/lessons/L1/state"
    assert body["slide"] == 2 and body["step"] == 2 and body["text"] == s.context_text()


async def test_checkpoint_survives_a_fold():
    agent = await agent_with_history()
    s = LessonState("L1", Post())
    s.note_slide(1, 1, "Speed right now.")
    await s.checkpoint(agent)
    chat = agent.chat_ctx.copy()  # what agent.fold() does
    chat.truncate(max_items=3)
    await agent.update_chat_ctx(chat)
    assert state_items(agent) == []
    await s.checkpoint(agent)
    assert agent.chat_ctx.items[1].id == STATE_ID


def test_apply_is_a_noop_when_nothing_changed():
    chat = llm.ChatContext()
    chat.add_message(role="system", content="instr", id="instructions")
    s = LessonState("L1")
    assert s.apply(chat) is True
    assert s.apply(chat) is False  # same text: don't touch the chat context (keeps the prompt cache warm)


async def test_unchanged_state_is_not_posted_twice():
    agent, post = await agent_with_history(), Post()
    s = LessonState("L1", post)
    await s.checkpoint(agent)
    await s.checkpoint(agent)
    assert len(post.calls) == 1


async def test_checkpoint_never_raises():
    class Broken:
        @property
        def chat_ctx(self):
            raise RuntimeError("no chat")

    s = LessonState("L1", Post(fail=True))
    await s.checkpoint(Broken())  # logs, does not raise
    agent = await agent_with_history()
    await s.checkpoint(agent)  # backend down: chat context still updated
    assert state_items(agent)


def test_rules_teach_the_tools():
    for name in ("detour_start", "detour_end", "mark_understanding", "set_anchor", "Lesson state"):
        assert name in lesson_state.RULES


async def test_snapshot_saves_the_main_branch_position_during_a_detour():
    agent, post = await agent_with_history(), Post()
    s = LessonState("L1", post)
    s.note_slide(3, 2, "Chords.")
    await s.detour_start("limits", "asked")
    s.note_slide(7, 1, "A follow-up slide.")
    await s.checkpoint(agent)
    body = post.calls[-1][1]
    assert (body["slide"], body["step"], body["idea"]) == (3, 2, "Chords.")
    assert body["detours"][0]["topic"] == "limits"
