import asyncio
from types import SimpleNamespace

import jsonschema

from workers import run_visual
from workers.animate import SCHEMA, animate

V = jsonschema.Draft202012Validator(SCHEMA)
UNAVAILABLE = [{"op": "write_text", "text": "(animation unavailable)", "place": "next"}]


class FakeAnthropic:
    def __init__(self, ops=None, delay=0):
        self.delay, self.kw = delay, None
        self.messages = SimpleNamespace(create=self._create)
        self._ops = ops

    async def _create(self, **kw):
        self.kw = kw
        await asyncio.sleep(self.delay)
        block = SimpleNamespace(type="tool_use", input={"ops": self._ops})
        return SimpleNamespace(content=[SimpleNamespace(type="text", text="ok"), block])


GOOD = [
    {"op": "write_text", "text": "Step one", "place": "next", "id": "a", "step": 1},
    {"op": "draw_shape", "shape": "rect", "place": "next", "id": "b", "step": 2},
    {"op": "draw_arrow", "from_id": "a", "to_id": "b", "step": 3},
]


def test_returns_ops_plus_first_reveal():
    fake = FakeAnthropic(GOOD)
    ops = asyncio.run(animate("how a stack works", "board has: x", client=fake))
    assert fake.kw["model"] == "claude-sonnet-5-5"
    assert fake.kw["tools"][0]["input_schema"]["properties"]["ops"]
    drawn, reveals = ops[:3], ops[3:]
    group = drawn[0]["group"]
    assert all(o["group"] == group for o in drawn)
    assert reveals == [{"op": "reveal_step", "group_id": group, "step": 1}]
    assert all(V.is_valid({"ops": [o]}) for o in ops)


def test_drops_invalid_ops():
    bad = [{"op": "explode"}, {"op": "write_text", "place": "next", "step": 1}] + GOOD[:2]
    ops = asyncio.run(animate("b", "", client=FakeAnthropic(bad)))
    assert [o["op"] for o in ops] == ["write_text", "draw_shape", "reveal_step"]
    assert asyncio.run(animate("b", "", client=FakeAnthropic([{"op": "explode"}]))) == UNAVAILABLE


def test_falls_back_on_timeout():
    ops = asyncio.run(animate("b", "", client=FakeAnthropic(GOOD, delay=1), timeout_s=0.1))
    assert ops == UNAVAILABLE


def test_run_visual_dispatches(monkeypatch):
    import workers

    async def fake_ill(brief, **kw):
        return ["ill", brief]

    async def fake_anim(brief, board_text, **kw):
        return ["anim", brief, board_text]

    monkeypatch.setattr(workers, "illustrate", fake_ill)
    monkeypatch.setattr(workers, "animate", fake_anim)
    assert asyncio.run(run_visual("illustration", "b", "t")) == ["ill", "b"]
    assert asyncio.run(run_visual("animation", "b", "t")) == ["anim", "b", "t"]


def test_exception_falls_back_and_logs(caplog):
    class Boom:
        def __init__(self):
            self.messages = SimpleNamespace(create=self._create)

        async def _create(self, **kw):
            raise RuntimeError("400 bad schema")

    with caplog.at_level("WARNING"):
        assert asyncio.run(animate("b", "", client=Boom())) == UNAVAILABLE
    assert "animate failed" in caplog.text and "400 bad schema" in caplog.text


def test_reveals_only_step_one():
    ops = asyncio.run(animate("b", "", client=FakeAnthropic(GOOD)))
    reveals = [o for o in ops if o["op"] == "reveal_step"]
    assert reveals == [{"op": "reveal_step", "group_id": ops[0]["group"], "step": 1}]


def test_prefixes_model_ids_with_group_and_keeps_board_refs():
    plan = [
        {"op": "write_math", "latex": "x", "place": "below:title", "id": "eq1", "step": 1},
        {"op": "write_text", "text": "t", "place": "right_of:eq1", "id": "t1", "step": 2},
        {"op": "draw_arrow", "from_id": "eq1", "to_id": "t1", "step": 2},
        {"op": "draw_arrow", "from_id": "title", "to_id": "eq1", "step": 3},
        {"op": "write_text", "text": "u", "place": "below:t1", "step": 3},
    ]
    ops = asyncio.run(animate("b", "title text tutor: Hi", client=FakeAnthropic(plan)))
    g = ops[0]["group"]
    assert ops[0]["id"] == f"{g}_eq1" and ops[0]["place"] == "below:title"
    assert ops[1]["id"] == f"{g}_t1" and ops[1]["place"] == f"right_of:{g}_eq1"
    assert (ops[2]["from_id"], ops[2]["to_id"]) == (f"{g}_eq1", f"{g}_t1")
    assert (ops[3]["from_id"], ops[3]["to_id"]) == ("title", f"{g}_eq1")
    assert ops[4]["place"] == f"below:{g}_t1"
    assert all(V.is_valid({"ops": [o]}) for o in ops)


def test_model_cannot_place_images():
    plan = [{"op": "place_image", "url": "https://evil/x.png", "place": "next", "step": 1}] + GOOD[:1]
    ops = asyncio.run(animate("b", "", client=FakeAnthropic(plan)))
    assert [o["op"] for o in ops] == ["write_text", "reveal_step"]
