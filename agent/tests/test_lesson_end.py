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
