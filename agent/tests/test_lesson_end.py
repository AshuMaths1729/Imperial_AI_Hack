import asyncio

from lesson_end import LessonEnder


class SlowPost:
    def __init__(self):
        self.calls = []

    async def __call__(self, path, body):
        self.calls.append((path, body))
        await asyncio.sleep(0.05)
        return {}


async def test_shutdown_posts_end_once():
    post = SlowPost()
    ender = LessonEnder(post, "L1")
    await asyncio.gather(ender.end("a", []), ender.end("b", []))
    await ender.end("c", [])
    assert len(post.calls) == 1


async def test_end_payload_has_summary_and_kps():
    post = SlowPost()
    await LessonEnder(post, "L1").end("Covered gradients.", ["m0:n1", "m0:n2"])
    assert post.calls == [
        ("/api/tutor/lessons/L1/end", {"summary": "Covered gradients.", "covered_kp_ids": ["m0:n1", "m0:n2"]})
    ]


async def test_finish_lesson_fits_shutdown_budget():
    import time

    from lesson_end import finish_lesson
    from rolling import RollingSummary

    async def slow_summarize(prev, turns):
        await asyncio.sleep(10)

    async def hanging_post(path, body):
        hanging_post.body = body
        await asyncio.sleep(10)

    rolling = RollingSummary(slow_summarize)
    rolling.summary = "rolling so far"
    rolling.add_turn("user", "hi")
    t0 = time.perf_counter()
    await finish_lesson(rolling, LessonEnder(hanging_post, "L1"), ["m0:n1"], slow_summarize,
                        summary_timeout=0.1, end_timeout=0.1)
    assert time.perf_counter() - t0 < 0.5
    assert hanging_post.body == {"summary": "rolling so far", "covered_kp_ids": ["m0:n1"]}


async def test_finish_lesson_uses_final_summary():
    from lesson_end import finish_lesson
    from rolling import RollingSummary

    async def summarize(prev, turns):
        return f"final of {len(turns)}"

    post = SlowPost()
    rolling = RollingSummary(summarize)
    rolling.add_turn("user", "hi")
    await finish_lesson(rolling, LessonEnder(post, "L1"), [], summarize)
    assert post.calls[0][1]["summary"] == "final of 1"
