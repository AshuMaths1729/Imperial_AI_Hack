import asyncio
import json
import sys
import time
import types
from pathlib import Path

import httpx
import pytest

from tutor_tools import TutorTools, as_tool_output

EXAMPLES = Path(__file__).resolve().parents[2] / "frontend/src/tutor/contracts/examples"
VALID_OPS = json.loads((EXAMPLES / "valid_ops.json").read_text())["ops"]
INVALID_CASES = json.loads((EXAMPLES / "invalid_ops.json").read_text())["cases"]


class FakeIO:
    def __init__(self, replies=None, frame=None, post_error=None):
        self.replies = replies or {}
        self.frame = frame
        self.post_error = post_error
        self.rpcs: list[tuple[str, dict]] = []
        self.posts: list[tuple[str, dict]] = []

    async def rpc(self, method, payload):
        self.rpcs.append((method, payload))
        reply = self.replies.get(method, {})
        return reply(payload) if callable(reply) else reply

    async def post(self, path, body):
        self.posts.append((path, body))
        if self.post_error:
            raise self.post_error
        return {}

    def latest_screen_frame(self):
        return self.frame


def ok_apply(payload):
    return {"ok": True, "ids": [op.get("id", f"auto{i}") for i, op in enumerate(payload["ops"])], "errors": []}


async def test_board_write_validates_and_forwards():
    io = FakeIO({"board.apply": ok_apply})
    out = await TutorTools(io, "L1").board_write(VALID_OPS)
    assert io.rpcs == [("board.apply", {"ops": VALID_OPS})]
    assert out.startswith("ok: drew ") and "eq_update" in out


async def test_board_write_reports_errors():
    io = FakeIO({"board.apply": {"ok": False, "ids": [], "errors": ["unknown target x"]}})
    out = await TutorTools(io, "L1").board_write([{"op": "highlight", "target_id": "x"}])
    assert out.startswith("failed")
    assert "unknown target x" in out


async def test_invalid_op_never_sent():
    io = FakeIO({"board.apply": ok_apply})
    tools = TutorTools(io, "L1")
    out = await tools.board_write([c["op"] for c in INVALID_CASES])
    assert io.rpcs == []
    assert out.startswith("failed")
    out = await tools.board_write([VALID_OPS[0], INVALID_CASES[0]["op"]])
    assert io.rpcs == [("board.apply", {"ops": [VALID_OPS[0]]})]
    assert out.startswith("partial: drew title; failed:")


async def test_look_at_board_formats_items():
    items = [
        {"id": "eq1", "type": "math", "author": "tutor", "latex": "x^2", "bbox": {}},
        {"id": "u1", "type": "text", "author": "user", "text": "I think 4", "bbox": {}},
    ]
    io = FakeIO({"board.describe": {"items": items}, "board.snapshot": {"png_b64": "PNG"}})
    tools = TutorTools(io, "L1")
    assert await tools.look_at_board() == "eq1 math tutor: x^2\nu1 text user: I think 4"
    region = {"x": 0, "y": 0, "w": 500, "h": 500}
    text, png, mime = await tools.look_at_board(region)
    assert png == "PNG" and mime == "image/png" and text.startswith("eq1")
    assert ("board.snapshot", {"region": region}) in io.rpcs


async def test_look_at_screen_without_share():
    assert await TutorTools(FakeIO(), "L1").look_at_screen() == "no screen is being shared"


async def test_look_at_screen_returns_frame():
    text, jpeg = await TutorTools(FakeIO(frame="JPEG"), "L1").look_at_screen()
    assert jpeg == "JPEG" and "screen" in text


async def test_mark_progress_404_message():
    resp = httpx.Response(404, request=httpx.Request("POST", "http://x"))
    io = FakeIO(post_error=httpx.HTTPStatusError("404", request=resp.request, response=resp))
    tools = TutorTools(io, "L1")
    assert await tools.mark_progress("m9:n9", "understood", "said so") == "failed: unknown kp m9:n9"
    assert tools.covered == []


async def test_mark_progress_posts_and_records_covered():
    io = FakeIO()
    tools = TutorTools(io, "L1")
    assert (await tools.mark_progress("m0:n1", "understood", "explained it back")).startswith("ok")
    assert io.posts == [
        ("/api/tutor/lessons/L1/progress",
         {"kp_updates": [{"kp_id": "m0:n1", "status": "understood", "evidence": "explained it back"}]})
    ]
    assert tools.covered == ["m0:n1"]
    await tools.note_struggle("m0:n2", "sign", ["analogy"])
    await tools.note_worked("m0:n2", "diagram")
    assert io.posts[1][1] == {"struggles": [{"kp_id": "m0:n2", "what": "sign", "tried_explanations": ["analogy"]}]}
    assert io.posts[2][1] == {"worked": [{"kp_id": "m0:n2", "explanation_style": "diagram"}]}


async def test_start_visual_returns_immediately(monkeypatch):
    done = asyncio.Event()

    async def run_visual(kind, brief, board_text):
        await asyncio.sleep(1)
        done.set()
        return []

    monkeypatch.setitem(sys.modules, "workers", types.SimpleNamespace(run_visual=run_visual, is_fallback=lambda ops: False))
    tools = TutorTools(FakeIO({"board.describe": {"items": []}}), "L1")
    t0 = time.perf_counter()
    assert await tools.start_visual("illustration", "a ball rolling into a valley") == "queued"
    assert time.perf_counter() - t0 < 0.05
    assert not done.is_set()
    for t in list(tools._tasks):
        t.cancel()


async def test_start_visual_not_available(monkeypatch):
    monkeypatch.setitem(sys.modules, "workers", None)  # makes `import workers` raise ImportError
    assert await TutorTools(FakeIO(), "L1").start_visual("animation", "x") == "not available"


def test_function_tools_exposed():
    from livekit.agents import llm

    names = {t.info.name for t in TutorTools(FakeIO(), "L1").function_tools()}
    assert names == {"board_write", "look_at_board", "look_at_screen", "mark_progress",
                     "note_struggle", "note_worked", "start_visual"}
    assert all(isinstance(t, (llm.FunctionTool, llm.RawFunctionTool)) for t in TutorTools(FakeIO(), "L1").function_tools())


@pytest.mark.parametrize("result,expected_type", [("plain", str), (("t", "B64"), list)])
async def test_tool_wrapper_attaches_image(result, expected_type):
    from tutor_tools import as_tool_output

    out = as_tool_output(result, "image/png")
    if expected_type is str:
        assert out == "plain"
    else:
        blocks = json.loads(out)
        assert blocks[0] == {"type": "text", "text": "t"}
        assert blocks[1]["source"] == {"type": "base64", "media_type": "image/png", "data": "B64"}


async def test_board_write_tool_schema_is_the_contract_and_forwards():
    from livekit.agents import llm

    io = FakeIO({"board.apply": ok_apply})
    tool = next(t for t in TutorTools(io, "L1").function_tools() if t.info.name == "board_write")
    schema = llm.ToolContext([tool]).parse_function_tools("anthropic", strict=True)[0]
    assert "strict" not in schema and "write_math" in schema["input_schema"]["$defs"]
    assert (await tool(raw_arguments={"ops": VALID_OPS[:1]})).startswith("ok: drew title")


async def test_board_write_not_ok_without_errors_is_failure():
    io = FakeIO({"board.apply": {"ok": False, "ids": [], "errors": []}})
    out = await TutorTools(io, "L1").board_write(VALID_OPS[:1])
    assert out == "failed: board rejected the ops"


async def test_board_write_non_string_errors():
    io = FakeIO({"board.apply": {"ok": False, "ids": ["title"], "errors": [{"code": 7}, None]}})
    out = await TutorTools(io, "L1").board_write(VALID_OPS[:2])
    assert out.startswith("partial: drew title; failed:") and "{'code': 7}" in out


async def test_look_at_board_jpeg_snapshot_uses_its_mime():
    io = FakeIO({"board.describe": {"items": []}, "board.snapshot": {"png_b64": "JPG", "mime": "image/jpeg"}})
    out = await TutorTools(io, "L1").look_at_board({"x": 0, "y": 0, "w": 10, "h": 10})
    assert out[1:] == ("JPG", "image/jpeg")
    blocks = json.loads(as_tool_output(out, "image/png"))
    assert blocks[1]["source"]["media_type"] == "image/jpeg"


async def test_look_at_board_missing_mime_is_png():
    io = FakeIO({"board.describe": {"items": []}, "board.snapshot": {"png_b64": "P"}})
    out = await TutorTools(io, "L1").look_at_board({"x": 0, "y": 0, "w": 10, "h": 10})
    assert json.loads(as_tool_output(out, "image/jpeg"))[1]["source"]["media_type"] == "image/png"


@pytest.mark.parametrize("reply", [{"ok": False, "errors": ["snapshot too large"]}, {}])
async def test_look_at_board_snapshot_failure_is_text_only(reply):
    io = FakeIO({"board.describe": {"items": []}, "board.snapshot": reply})
    out = await TutorTools(io, "L1").look_at_board({"x": 0, "y": 0, "w": 10, "h": 10})
    assert isinstance(out, str) and "couldn't capture the board" in out
    assert as_tool_output(out, "image/png") == out


def _board_write_description():
    tool = next(t for t in TutorTools(FakeIO(), "L1").function_tools() if t.info.name == "board_write")
    return tool.info.raw_schema["description"]


def test_board_write_description_explains_hidden_steps():
    d = _board_write_description()
    assert "HIDDEN" in d and "reveal_step" in d and "group" in d


def test_board_write_description_gives_plot_syntax():
    d = _board_write_description()
    assert "exp(-0.3*x)*cos(2*x)" in d and "x^2" in d


@pytest.mark.parametrize("reply", [{"ok": False, "ids": [], "errors": ["whiteboard is not ready"]}, {}])
async def test_board_text_failed_describe_is_not_an_empty_board(reply):
    out = await TutorTools(FakeIO({"board.describe": reply}), "L1").board_text()
    assert out.startswith("couldn't read the board")
    assert "empty" not in out
    if reply:
        assert "whiteboard is not ready" in out


async def test_look_at_board_accepts_float_region():
    from livekit.agents.llm.utils import prepare_function_arguments

    io = FakeIO({"board.describe": {"items": []}, "board.snapshot": {"png_b64": "P"}})
    tool = next(t for t in TutorTools(io, "L1").function_tools() if t.info.name == "look_at_board")
    region = {"x": 10.5, "y": 20.2, "w": 300.7, "h": 200}
    args, kwargs = prepare_function_arguments(fnc=tool, json_arguments={"region": region})
    await tool(*args, **kwargs)
    assert ("board.snapshot", {"region": {"x": 10, "y": 20, "w": 301, "h": 200}}) in io.rpcs


UNAVAILABLE_NOTE = ("Visual unavailable: how a stack works — explain it in words or draw it yourself with board_write")


async def _run_visual_with(monkeypatch, ops, apply=ok_apply, fallback=False, describe=None):
    async def run_visual(kind, brief, board_text):
        return ops

    monkeypatch.setitem(sys.modules, "workers",
                        types.SimpleNamespace(run_visual=run_visual, is_fallback=lambda o: fallback))
    notes: list[str] = []

    async def on_note(text):
        notes.append(text)

    tools = TutorTools(FakeIO({"board.describe": describe or {"items": []}, "board.apply": apply}), "L1",
                       on_note=on_note)
    assert await tools.start_visual("animation", "how a stack works") == "queued"
    await asyncio.gather(*tools._tasks)
    return notes


async def test_visual_ready_note_after_animation_drawn(monkeypatch):
    ops = [
        {"op": "write_text", "id": "g_a", "text": "push", "place": "next", "group": "anim_1", "step": 1},
        {"op": "write_text", "id": "g_b", "text": "pop", "place": "next", "group": "anim_1", "step": 3},
        {"op": "reveal_step", "group_id": "anim_1", "step": 1},
    ]
    notes = await _run_visual_with(monkeypatch, ops)
    assert notes == ["Visual ready: how a stack works (group anim_1, steps 1..3; "
                     "reveal later steps with reveal_step as you explain)"]


async def test_visual_ready_note_for_illustration(monkeypatch):
    notes = await _run_visual_with(monkeypatch, [{"op": "place_image", "url": "https://x/i.png", "place": "next"}])
    assert notes == ["Visual ready: how a stack works"]


async def test_unavailable_note_when_board_write_fails(monkeypatch):
    notes = await _run_visual_with(monkeypatch, [{"op": "write_text", "text": "x", "place": "next"}],
                                   apply={"ok": False, "ids": [], "errors": ["nope"]})
    assert notes == [UNAVAILABLE_NOTE]


async def test_unavailable_note_when_worker_fell_back(monkeypatch):
    notes = await _run_visual_with(monkeypatch, [{"op": "write_text", "text": "(animation unavailable)", "place": "next"}],
                                   fallback=True)
    assert notes == [UNAVAILABLE_NOTE]


async def test_unavailable_note_when_board_raises(monkeypatch):
    def boom(payload):
        raise RuntimeError("the student's page is not connected")

    notes = await _run_visual_with(monkeypatch, [{"op": "write_text", "text": "x", "place": "next"}], describe=boom)
    assert notes == [UNAVAILABLE_NOTE]


async def test_board_write_tool_clears_a_board_circle_and_asks_to_explain_line_by_line():
    from circle import PendingCircle

    io = FakeIO({"board.apply": {"ok": True, "ids": ["s1", "s2"], "errors": []},
                 "ui.clear_circle": {"ok": True, "errors": []}})
    circle = PendingCircle(io)
    circle.open({"circle_id": "c7", "source": "board"})
    tool = next(t for t in TutorTools(io, "L1", circle=circle).function_tools() if t.info.name == "board_write")
    ops = [{"op": "write_math", "id": "s1", "latex": "2x+3=11", "place": "next"},
           {"op": "write_math", "id": "s2", "latex": "2x=8", "place": "below:s1"}]
    out = await tool(raw_arguments={"ops": ops})
    assert io.rpcs[0] == ("ui.clear_circle", {"circle_id": "c7"})  # the explanation starts: the circle goes
    assert out.startswith("ok: drew s1, s2") and "line by line" in out and "[[s1]]" in out
    await tool(raw_arguments={"ops": ops[:1]})
    assert [m for m, _ in io.rpcs].count("ui.clear_circle") == 1
