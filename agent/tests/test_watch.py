import asyncio
from types import SimpleNamespace

from livekit.agents import llm

import watch
from tutor_tools import _op_error
from watch import check_handwriting, handle_idle

PAYLOAD = {"png_b64": "JPEG", "mime": "image/jpeg", "region": {"x": 100, "y": 1200, "w": 400, "h": 200},
           "item_ids": ["s1", "s2"], "idle_ms": 6000}
ITEMS = [
    {"id": "q1", "type": "math", "author": "tutor", "latex": "w=3-0.5\\cdot 6", "bbox": {"x": 40, "y": 1000, "w": 500, "h": 60}},
    {"id": "s1", "type": "ink", "author": "user", "bbox": {"x": 120, "y": 1220, "w": 150, "h": 50}},
    {"id": "s2", "type": "ink", "author": "user", "bbox": {"x": 300, "y": 1300, "w": 150, "h": 60}},
]


class FakeClient:
    """anthropic.AsyncAnthropic stand-in: records the request, answers with one forced tool call."""

    def __init__(self, tool_input=None, error=None, delay=0.0):
        self.tool_input, self.error, self.delay, self.requests = tool_input, error, delay, []
        self.messages = self

    async def create(self, **kw):
        self.requests.append(kw)
        await asyncio.sleep(self.delay)
        if self.error:
            raise self.error
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self.tool_input)])


class FakeIO:
    async def rpc(self, method, payload):
        assert method == "board.describe"
        return {"items": ITEMS}


class FakeTools:
    def __init__(self):
        self.io = FakeIO()
        self.writes = []

    async def board_text(self):
        return "q1 math tutor: w=3-0.5\\cdot 6"

    async def board_write(self, ops):
        self.writes.append(ops)
        return "ok: drew"


class FakeAgent:
    def __init__(self):
        self.chat_ctx = llm.ChatContext()
        self.chat_ctx.add_message(role="assistant", content="If the learning rate were 0.5, what is the new w?")


class FakeSession:
    def __init__(self, state="listening"):
        self.agent_state = state
        self.user_state = "listening"
        self.replies = []

    def generate_reply(self, **kw):
        self.replies.append(kw)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def run(session, tools, check, clock=None, payload=PAYLOAD):
    return handle_idle(FakeAgent(), session, tools, payload, check=check, now=clock or Clock())


def verdict(v, **kw):
    async def check(png_b64, mime, context):
        check.calls.append((png_b64, mime, context))
        return {"verdict": v, **kw}

    check.calls = []
    return check


# --- the fast Haiku check ---------------------------------------------------------------------------------------

async def test_check_sends_image_and_forces_the_tool():
    client = FakeClient({"verdict": "mistake", "box": {"x": 0.1, "y": 0.5, "w": 0.4, "h": 0.3},
                         "say": "6 times 0.5 is 3, not 2", "correction_latex": "w = 0"})
    out = await check_handwriting("JPEG", "image/jpeg", "tutor asked: new w?", client=client)
    assert out["verdict"] == "mistake" and out["correction_latex"] == "w = 0"
    req = client.requests[0]
    assert req["model"] == "claude-haiku-5-5"
    assert req["tool_choice"] == {"type": "tool", "name": "report_check"}
    image, text = req["messages"][0]["content"]
    assert image["source"] == {"type": "base64", "media_type": "image/jpeg", "data": "JPEG"}
    assert "tutor asked: new w?" in text["text"]


async def test_check_failure_or_garbage_is_ok():
    assert (await check_handwriting("A", "image/png", "", client=FakeClient(error=RuntimeError("down"))))["verdict"] == "ok"
    assert (await check_handwriting("A", "image/png", "", client=FakeClient({"verdict": "maybe"})))["verdict"] == "ok"


async def test_check_times_out_to_ok():
    out = await check_handwriting("A", "image/png", "", client=FakeClient({"verdict": "hint"}, delay=1), timeout_s=0.01)
    assert out["verdict"] == "ok"


# --- handle_idle ------------------------------------------------------------------------------------------------

async def test_never_checks_while_the_tutor_speaks():
    check = verdict("mistake")
    for state in ("speaking", "thinking"):
        session = FakeSession(state)
        await run(session, FakeTools(), check)
        assert session.replies == []
    assert check.calls == []


async def test_ok_stays_silent():
    session, tools = FakeSession(), FakeTools()
    check = verdict("ok")
    await run(session, tools, check)
    assert check.calls and session.replies == [] and tools.writes == []


async def test_check_context_has_the_tutor_question_and_board():
    check = verdict("ok")
    await run(FakeSession(), FakeTools(), check)
    png, mime, context = check.calls[0]
    assert (png, mime) == ("JPEG", "image/jpeg")
    assert "what is the new w?" in context and "w=3-0.5" in context


async def test_hint_is_one_spoken_turn_without_drawing():
    session, tools = FakeSession(), FakeTools()
    await run(session, tools, verdict("hint", say="Start from the update rule."))
    assert tools.writes == []
    [reply] = session.replies
    assert "Start from the update rule." in reply["instructions"]


async def test_mistake_circles_red_writes_below_then_explains():
    session, tools = FakeSession(), FakeTools()
    box = {"x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4}  # lower-right part of the 400x200 snapshot at (100,1200)
    await run(session, tools, verdict("mistake", box=box, say="0.5 times 6 is 3", correction_latex="w = 3 - 3 = 0"))
    [ops] = tools.writes
    assert [_op_error(i, op) for i, op in enumerate(ops)] == [None, None]  # valid board-op contract
    mark, fix = ops
    assert mark["op"] == "annotate" and mark["mark"] == "circle" and mark["color"] == "red"
    r = mark["region"]
    assert r["x"] <= 300 <= 460 <= r["x"] + r["w"] and r["y"] <= 1300 <= 1380 <= r["y"] + r["h"]
    assert fix["op"] == "write_math" and fix["latex"] == "w = 3 - 3 = 0"
    # beneath the circled part at its natural size (a fixed region box shrank it to unreadable live)
    assert fix["place"] == f"below:{mark['id']}"
    [reply] = session.replies
    assert "0.5 times 6 is 3" in reply["instructions"] and fix["id"] in reply["instructions"]


async def test_mistake_without_box_circles_the_whole_recent_region():
    tools = FakeTools()
    await run(FakeSession(), tools, verdict("mistake", say="sign error", correction_latex="x=-2"))
    mark = tools.writes[0][0]
    r = mark["region"]
    assert r["x"] <= 100 and r["y"] <= 1200 and r["x"] + r["w"] >= 500 and r["y"] + r["h"] >= 1400


async def test_mistake_without_correction_only_circles():
    tools, session = FakeTools(), FakeSession()
    await run(session, tools, verdict("mistake", say="check the sign"))
    assert [op["op"] for op in tools.writes[0]] == ["annotate"]
    assert session.replies


async def test_board_failure_still_explains_in_words():
    class Broken(FakeTools):
        async def board_write(self, ops):
            self.writes.append(ops)
            return "failed: annotate is not implemented yet"

    session = FakeSession()
    await run(session, Broken(), verdict("mistake", say="sign error", correction_latex="x=-2"))
    assert "in words" in session.replies[0]["instructions"]


async def test_tutor_started_speaking_during_the_check():
    session, tools = FakeSession(), FakeTools()

    async def check(png_b64, mime, context):
        session.agent_state = "speaking"
        return {"verdict": "mistake", "say": "x", "correction_latex": "y"}

    await run(session, tools, check)
    assert session.replies == [] and tools.writes == []


async def test_rate_limited_to_one_intervention_per_window():
    session, tools, clock = FakeSession(), FakeTools(), Clock()
    hint = verdict("hint", say="h")
    await run(session, tools, hint, clock)
    clock.t += watch.MIN_GAP_S - 1
    await run(session, tools, hint, clock)
    assert len(session.replies) == 1 and len(hint.calls) == 1  # second pause not even checked
    clock.t += 2
    await run(session, tools, hint, clock)
    assert len(session.replies) == 2


async def test_ok_does_not_use_up_the_window():
    session, tools, clock = FakeSession(), FakeTools(), Clock()
    await run(session, tools, verdict("ok"), clock)
    clock.t += 1
    await run(session, tools, verdict("hint", say="h"), clock)
    assert len(session.replies) == 1


async def test_one_check_at_a_time():
    session, tools = FakeSession(), FakeTools()
    gate = asyncio.Event()

    async def slow(png_b64, mime, context):
        slow.calls += 1
        await gate.wait()
        return {"verdict": "hint", "say": "h"}

    slow.calls = 0
    first = asyncio.create_task(run(session, tools, slow))
    await asyncio.sleep(0)
    await run(session, tools, slow)  # arrives while the first check is still running
    gate.set()
    await first
    assert slow.calls == 1 and len(session.replies) == 1


async def test_bad_payload_is_ignored():
    session = FakeSession()
    check = verdict("hint", say="h")
    await run(session, FakeTools(), check, payload={"mime": "image/jpeg"})
    assert check.calls == [] and session.replies == []


def test_rules_teach_circle_write_below_explain():
    assert "annotate" in watch.RULES and "below" in watch.RULES and "red" in watch.RULES


def test_checker_describes_only_what_is_literally_written():
    # v3.1 F9: the checker said "your working" when only "ANS = 4" was on the board
    assert "literally" in watch.SYSTEM and "ANS = 4" in watch.SYSTEM and "no working" in watch.SYSTEM
    assert "literally" in watch.TOOL["input_schema"]["properties"]["say"]["description"]


async def test_spoken_reactions_stick_to_what_was_written():
    session, tools = FakeSession(), FakeTools()
    await run(session, tools, verdict("hint", say="Start from the update rule."))
    assert "only what they actually wrote" in session.replies[0]["instructions"]
    session, tools = FakeSession(), FakeTools()
    await run(session, tools, verdict("mistake", say="the sign is wrong", correction_latex="x=4"))
    assert "only what they actually wrote" in session.replies[0]["instructions"]
