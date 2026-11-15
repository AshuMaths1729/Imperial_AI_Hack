from livekit.agents import llm

from circle import PendingCircle, circle_message, handle_circle, handle_lost, lost_message

PAYLOAD = {"png_b64": "AAAA", "region": {"x": 1, "y": 2, "w": 3, "h": 4}, "item_ids": ["eq1", "u1"], "user_text": "why minus?"}


def test_circle_message_has_image_and_items():
    msg = circle_message({**PAYLOAD, "circle_id": "c7"}, "eq1 math tutor: x^2")
    assert msg.role == "user"
    text, image = msg.content
    assert text.startswith('[circled on board] circle_id=c7 items=eq1, u1 said="why minus?" board:\neq1 math tutor: x^2\n')
    assert isinstance(image, llm.ImageContent) and image.image == "data:image/png;base64,AAAA"


def test_circle_turn_asks_first_and_explains_only_after_the_answer():
    # live v2: a circle triggered an instant lecture; the student wants to be asked what is unclear first
    text = circle_message({**PAYLOAD, "circle_id": "c7"}, "").content[0]
    ask, after = text.split("After I answer", 1)
    assert "Don't explain yet" in ask and "what about it is unclear" in ask and "wait for my answer" in ask
    assert "board_write" not in ask and "slide_explain" not in ask  # no tool before the student has answered
    assert "board_write" in after and "[[eq1]]" in after  # board circles: explain next to the circled items, laser on them
    assert "one line at a time" in after and "then write the next line" in after  # v3.2 G6: a line, then its explanation
    # v3.1 F2: the circle clears by itself as the explanation starts; still ask if it helped, no clear_circle then
    assert "helped" in after and "clears by itself" in after and 'clear_circle("c7")' not in after


def test_circle_message_without_items_or_id():
    text = circle_message({"png_b64": "A", "region": {}, "item_ids": []}, "").content[0]
    assert 'circle_id=none items=none said=""' in text
    assert "clear_circle" not in text  # an old page without circle ids: nothing to clear


def test_circle_message_names_screen_source():
    assert circle_message({**PAYLOAD, "source": "screen"}, "").content[0].startswith("[circled on screen]")


def test_slide_circle_explains_in_a_pop_up_beside_the_slide():
    text = circle_message({**PAYLOAD, "source": "slide", "slide_id": "s3", "item_ids": ["curve"], "circle_id": "k1"},
                          "").content[0]
    assert text.startswith('[circled on slide s3] circle_id=k1 items=curve said="why minus?"')
    after = text.split("After I answer", 1)[1]
    assert "slide_explain(brief=..., object_ids=['curve'])" in after  # v3.2 G2: a pop-up, the slide stays as it is
    assert "explain_step" in after and "close_explanation()" in after and "helped" in after
    assert "slide_animate" in after and "not on this slide" in after  # a new slide only for ideas not on the page
    assert "clears by itself" in after and 'clear_circle("k1")' not in after
    assert "point_at" not in text and 'show_tab("board")' not in text  # stay on the slide


def test_screen_circle_is_cleared_by_the_tutor_as_it_explains():
    after = circle_message({**PAYLOAD, "source": "screen", "circle_id": "w1"}, "").content[0].split("After I answer", 1)[1]
    assert 'clear_circle("w1")' in after and after.index("clear_circle") < after.index("helped")


class RpcIO:
    def __init__(self, fail=False):
        self.rpcs, self.fail = [], fail

    async def rpc(self, method, payload):
        self.rpcs.append((method, payload))
        if self.fail:
            raise RuntimeError("page gone")
        return {"ok": True, "errors": []}


async def test_pending_circle_clears_once_for_its_own_stage():
    io = RpcIO()
    c = PendingCircle(io)
    assert await c.clear("slide") is False  # nothing circled
    c.open({"circle_id": "c7", "source": "board"})
    assert await c.clear("slide") is False and io.rpcs == []  # a slide explanation leaves a board circle alone
    assert await c.clear("board") is True
    assert await c.clear("board") is False
    assert io.rpcs == [("ui.clear_circle", {"circle_id": "c7"})]
    c.open({"source": "slide"})  # an old page without circle ids
    assert await c.clear("slide") is False


async def test_pending_circle_never_raises():
    c = PendingCircle(RpcIO(fail=True))
    c.open({"circle_id": "c1", "source": "slide"})
    assert await c.clear("slide") is False and c.id is None


def test_screen_circle_keeps_plain_reexplain():
    text = circle_message({**PAYLOAD, "source": "screen"}, "").content[0]
    assert "start_visual" not in text and "point_at" not in text and "different way" in text


def test_lost_message_quotes_last_spoken():
    spoken = "a" * 400 + "b" * 200
    msg = lost_message(spoken)
    assert msg.role == "user"
    assert msg.text_content == (
        '[I\'m lost] You were saying: "' + "b" * 200 + '". I got lost there. '
        "Check what I'm missing and explain it differently."
    )


class FakeAgent:
    def __init__(self, ctx):
        self.chat_ctx = ctx

    async def update_chat_ctx(self, ctx):
        self.chat_ctx = ctx


class FakeSession:
    def __init__(self, speaking):
        self.agent_state = "speaking" if speaking else "listening"
        self.calls = []

    def interrupt(self):
        self.calls.append("interrupt")
        import asyncio

        fut = asyncio.get_running_loop().create_future()
        fut.set_result(None)
        return fut

    def generate_reply(self, **kw):
        self.calls.append("generate_reply")


async def test_handle_lost_interrupts_and_quotes_last_assistant_message():
    ctx = llm.ChatContext()
    ctx.add_message(role="assistant", content="First the gradient points uphill")
    ctx.add_message(role="user", content="ok")
    agent, session = FakeAgent(ctx), FakeSession(speaking=True)
    await handle_lost(agent, session)
    assert session.calls == ["interrupt", "generate_reply"]
    assert "First the gradient points uphill" in agent.chat_ctx.items[-1].text_content
    assert ctx.items[-1].text_content == "ok"  # original context untouched (copied)


async def test_handle_circle_skips_interrupt_when_silent():
    agent, session = FakeAgent(llm.ChatContext()), FakeSession(speaking=False)
    await handle_circle(agent, session, PAYLOAD, "board")
    assert session.calls == ["generate_reply"]
    assert isinstance(agent.chat_ctx.items[-1].content[1], llm.ImageContent)


class _Stream(llm.LLMStream):
    async def _run(self):
        self._llm.seen.append(self.chat_ctx.copy())
        self._event_ch.send_nowait(llm.ChatChunk(id="1", delta=llm.ChoiceDelta(role="assistant", content="Look here.")))


class _FakeLLM(llm.LLM):
    def __init__(self):
        super().__init__()
        self.seen = []

    def chat(self, *, chat_ctx, tools=None, conn_options=None, **kw):
        from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

        return _Stream(self, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS)


async def test_circle_reaches_the_llm_with_its_image_in_a_real_session():
    """The live path minus LiveKit transport: a real AgentSession sends the circled crop to the LLM."""
    import asyncio

    from livekit.agents import Agent, AgentSession
    from livekit.agents.llm._provider_format.anthropic import to_chat_ctx

    fake = _FakeLLM()
    session = AgentSession(llm=fake)
    agent = Agent(instructions="tutor")
    await session.start(agent)
    try:
        await handle_circle(agent, session, {**PAYLOAD, "source": "board"}, "eq1 math tutor: x^2")
        for _ in range(100):
            if fake.seen:
                break
            await asyncio.sleep(0.02)
        messages, _ = to_chat_ctx(fake.seen[-1])  # what the Anthropic plugin would send
        assert [c["type"] for c in messages[-1]["content"]] == ["text", "image"]
        assert messages[-1]["content"][1]["source"]["data"] == "AAAA"
    finally:
        await session.aclose()
