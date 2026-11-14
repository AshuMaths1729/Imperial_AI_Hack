import asyncio
import json
import sys
import time
import types
from pathlib import Path

import httpx
import pytest

from tutor_tools import TutorTools

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
    text, png = await tools.look_at_board(region)
    assert png == "PNG" and text.startswith("eq1")
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

    monkeypatch.setitem(sys.modules, "workers", types.SimpleNamespace(run_visual=run_visual))
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
