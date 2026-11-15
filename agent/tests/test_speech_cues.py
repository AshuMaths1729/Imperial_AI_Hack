import asyncio

from livekit.agents import Agent
from livekit.agents.voice.io import TimedString

import speech_cues
from speech_cues import SpeechCues, TagStripper


def strip(*chunks):
    t = TagStripper()
    said = "".join(t.feed(c) for c in chunks) + t.flush()
    return said, t.cues


def test_tags_are_stripped_and_point_at_the_next_word():
    said, cues = strip("the [[rise]] rise over the [[run]] run.")
    assert said == "the rise over the run."
    assert cues == [{"word": 1, "id": "rise"}, {"word": 4, "id": "run"}]


def test_tag_split_across_chunks_is_never_let_through():
    chunks = ["So [", "[ri", "se", "]", "] rise over [[r", "un]] run"]
    t = TagStripper()
    outs = [t.feed(c) for c in chunks] + [t.flush()]
    assert all("[" not in o and "]" not in o for o in outs)
    assert "".join(outs) == "So rise over run"
    assert t.cues == [{"word": 1, "id": "rise"}, {"word": 3, "id": "run"}]


def test_tag_first_and_board_ids():
    said, cues = strip("[[s1]] First we subtract three, then [[s_2]] divide.")
    assert said == "First we subtract three, then divide."
    assert cues == [{"word": 0, "id": "s1"}, {"word": 5, "id": "s_2"}]


def test_plain_brackets_and_unfinished_tags_are_kept_as_text():
    assert strip("a [b] c")[0] == "a [b] c"
    assert strip("x [[unfinished")[0] == "x [[unfinished"
    said, cues = strip("odd [[a b]] tag")  # any double-bracket tag is silent; the page ignores unknown ids
    assert said == "odd tag" and cues == [{"word": 1, "id": "a b"}]


async def _drain(gen):
    return [c async for c in gen]


async def _chunks(*parts, delay=0.0):
    for p in parts:
        await asyncio.sleep(delay)
        yield p


class Key:
    pass


async def test_cues_are_sent_before_the_first_caption_of_that_speech():
    sent, order = [], []

    async def rpc(method, payload):
        sent.append((method, payload))
        order.append("rpc")
        return {"ok": True}

    handle = Key()
    cues = SpeechCues(rpc, key=lambda: handle)
    spoken = cues.tts_text(_chunks("the [[ri", "se]] rise over the [[run]] run"))
    captions = cues.captions(_chunks(TimedString("the "), TimedString("rise "), delay=0.01))
    tts_out, caps = await asyncio.gather(_drain(spoken), _drain(captions))
    order.append("captions done")
    assert "".join(tts_out) == "the rise over the run"
    assert caps == ["the ", "rise "]
    await asyncio.sleep(0)
    assert sent == [("ui.point_cues", {"cues": [{"word": 1, "id": "rise"}, {"word": 4, "id": "run"}]})]
    assert order[0] == "rpc"


async def test_no_tags_no_rpc_and_rpc_failure_never_raises():
    calls = []

    async def rpc(method, payload):
        calls.append(method)
        raise RuntimeError("the student's page is not connected")

    handle = Key()
    cues = SpeechCues(rpc, key=lambda: handle)
    await _drain(cues.tts_text(_chunks("just words")))
    assert await _drain(cues.captions(_chunks(TimedString("just words")))) == ["just words"]
    assert calls == []
    await _drain(cues.tts_text(_chunks("[[a]] tagged")))
    assert await _drain(cues.captions(_chunks(TimedString("tagged")))) == ["tagged"]
    await asyncio.sleep(0.01)
    assert calls == ["ui.point_cues"]  # failed, logged, nothing raised


async def test_fallback_captions_from_raw_text_are_stripped():
    # no TTS alignment: the transcript is the raw LLM text, tags included
    cues = SpeechCues(lambda m, p: asyncio.sleep(0, {"ok": True}), key=lambda: Key())
    caps = await _drain(cues.captions(_chunks("the [[ri", "se]] rise")))
    assert "".join(caps) == "the rise"


async def test_segments_pair_up_per_speech():
    sent = []

    async def rpc(method, payload):
        sent.append(payload["cues"])
        return {}

    a, b = Key(), Key()
    current = {"k": a}
    cues = SpeechCues(rpc, key=lambda: current["k"])
    await _drain(cues.tts_text(_chunks("[[x]] one")))  # speech a, e.g. a discarded preemptive reply
    current["k"] = b
    await _drain(cues.tts_text(_chunks("two [[y]] three")))
    await _drain(cues.captions(_chunks(TimedString("two three"))))
    await asyncio.sleep(0)
    assert sent == [[{"word": 1, "id": "y"}]]


async def test_slow_text_does_not_hold_captions_forever(monkeypatch):
    monkeypatch.setattr(speech_cues, "CUE_WAIT_S", 0.05)
    sent = []

    async def rpc(method, payload):
        sent.append(payload["cues"])
        return {}

    gate = asyncio.Event()

    async def slow():
        yield "[[a]] first "
        await gate.wait()  # e.g. a long tool call after the sentence
        yield "later"

    h = Key()
    cues = SpeechCues(rpc, key=lambda: h)
    tts = asyncio.ensure_future(_drain(cues.tts_text(slow())))
    caps = await _drain(cues.captions(_chunks(TimedString("first "))))
    assert caps == ["first "] and sent == [[{"word": 0, "id": "a"}]]
    gate.set()
    assert "".join(await tts) == "first later"


async def test_agent_strips_tags_before_tts(monkeypatch):
    import agent as agent_mod

    seen = []

    async def fake_default_tts(agent, text, model_settings):
        seen.extend([c async for c in text])
        yield "audio"

    monkeypatch.setattr(Agent.default, "tts_node", fake_default_tts)
    tutor = agent_mod.TutorAgent(SpeechCues(lambda m, p: asyncio.sleep(0), key=lambda: Key()), instructions="x")
    frames = [f async for f in tutor.tts_node(_chunks("the [[rise]] rise"), None)]
    assert frames == ["audio"] and "".join(seen) == "the rise"
    caps = [c async for c in tutor.transcription_node(_chunks("the [[rise]] rise"), None)]
    assert "".join(caps) == "the rise"


async def test_tags_never_reach_chat_history_in_a_real_session():
    """The live path minus transport (no TTS here, so the transcript is the raw LLM text): the stored reply is clean."""
    from livekit.agents import AgentSession, llm
    from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

    import agent as agent_mod

    class Stream(llm.LLMStream):
        async def _run(self):
            for part in ("the [[ri", "se]] rise over the [[run]] run."):
                self._event_ch.send_nowait(llm.ChatChunk(id="1", delta=llm.ChoiceDelta(role="assistant", content=part)))

    class FakeLLM(llm.LLM):
        def chat(self, *, chat_ctx, tools=None, conn_options=None, **kw):
            return Stream(self, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS)

    session = AgentSession(llm=FakeLLM())
    tutor = agent_mod.TutorAgent(SpeechCues(lambda m, p: asyncio.sleep(0)), instructions="tutor")
    await session.start(tutor)
    try:
        await session.generate_reply(user_input="hi")
        said = [i.text_content for i in tutor.chat_ctx.items if i.type == "message" and i.role == "assistant"]
        assert said == ["the rise over the run."]
    finally:
        await session.aclose()
