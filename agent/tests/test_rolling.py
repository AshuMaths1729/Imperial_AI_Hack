from rolling import RollingSummary


class FakeSummarizer:
    def __init__(self):
        self.calls = []

    async def __call__(self, prev, turns):
        self.calls.append((prev, list(turns)))
        return f"S{len(self.calls)}"


async def test_no_fold_below_threshold():
    s = FakeSummarizer()
    r = RollingSummary(s, keep_last=3, fold_every=2)
    for i in range(5):
        r.add_turn("user", f"t{i}")
    assert await r.maybe_fold() is False
    assert s.calls == [] and r.summary == "" and len(r.recent) == 5


async def test_fold_keeps_last_n_and_updates_summary():
    s = FakeSummarizer()
    r = RollingSummary(s, keep_last=3, fold_every=2)
    for i in range(6):
        r.add_turn("user" if i % 2 else "assistant", f"t{i}")
    assert await r.maybe_fold() is True
    assert r.recent == ["user: t3", "assistant: t4", "user: t5"]
    assert r.summary == "S1"
    assert s.calls[0][1] == ["assistant: t0", "user: t1", "assistant: t2"]


async def test_fold_passes_previous_summary():
    s = FakeSummarizer()
    r = RollingSummary(s, keep_last=3, fold_every=2)
    for i in range(6):
        r.add_turn("user", f"a{i}")
    await r.maybe_fold()
    for i in range(3):
        r.add_turn("user", f"b{i}")
    assert await r.maybe_fold() is True
    assert s.calls[1][0] == "S1"
    assert r.summary == "S2"
