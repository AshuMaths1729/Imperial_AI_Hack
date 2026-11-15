import asyncio

from workers.illustrate import illustrate


class FakeFal:
    def __init__(self, delay=0, result=None):
        self.delay, self.result, self.calls = delay, result, []

    async def subscribe_async(self, app, arguments=None, **kw):
        self.calls.append((app, arguments))
        await asyncio.sleep(self.delay)
        return self.result if self.result is not None else {"images": [{"url": "https://fal.media/x.png"}]}


def test_returns_place_image_op_on_success():
    fake = FakeFal()
    ops = asyncio.run(illustrate("a cell diagram " * 10, client=fake))
    assert ops == [{"op": "place_image", "url": "https://fal.media/x.png",
                    "caption": ("a cell diagram " * 10)[:60], "place": "next"}]
    assert fake.calls[0][0] == "fal-ai/flux/schnell"


def test_falls_back_to_text_on_timeout():
    ops = asyncio.run(illustrate("x", client=FakeFal(delay=6), timeout_s=0.1))
    assert ops == [{"op": "write_text", "text": "(sketch unavailable — let me describe it)", "place": "next"}]


def test_falls_back_on_non_https_or_error():
    bad = FakeFal(result={"images": [{"url": "http://insecure/x.png"}]})
    assert asyncio.run(illustrate("x", client=bad))[0]["op"] == "write_text"
    assert asyncio.run(illustrate("x", client=FakeFal(result={})))[0]["op"] == "write_text"


def test_exception_and_none_url_fall_back_and_log(caplog):
    class Boom:
        async def subscribe_async(self, *a, **kw):
            raise RuntimeError("bad key")

    with caplog.at_level("WARNING"):
        assert asyncio.run(illustrate("x", client=Boom()))[0]["op"] == "write_text"
    assert "illustrate failed" in caplog.text and "bad key" in caplog.text
    none_url = FakeFal(result={"images": [{"url": None}]})
    assert asyncio.run(illustrate("x", client=none_url))[0]["op"] == "write_text"
