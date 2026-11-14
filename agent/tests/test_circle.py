from livekit.agents import llm

from circle import circle_message, handle_circle, handle_lost, lost_message

PAYLOAD = {"png_b64": "AAAA", "region": {"x": 1, "y": 2, "w": 3, "h": 4}, "item_ids": ["eq1", "u1"], "user_text": "why minus?"}


def test_circle_message_has_image_and_items():
    msg = circle_message(PAYLOAD, "eq1 math tutor: x^2")
    assert msg.role == "user"
    text, image = msg.content
    assert text.startswith('[circled on board] items=eq1, u1 said="why minus?" board:\neq1 math tutor: x^2\n')
    assert "Re-explain what I circled in a different way than what's already on the board." in text
    assert "point_at" in text  # board circles: show what you mean on the circled items
    assert isinstance(image, llm.ImageContent) and image.image == "data:image/png;base64,AAAA"


def test_circle_message_without_items_says_none():
    text = circle_message({"png_b64": "A", "region": {}, "item_ids": []}, "")
    assert 'items=none said=""' in text.content[0]


def test_circle_message_names_screen_source():
    assert circle_message({**PAYLOAD, "source": "screen"}, "").content[0].startswith("[circled on screen]")


def test_slide_circle_routes_to_animation_or_handwritten_working():
    text = circle_message({**PAYLOAD, "source": "slide", "slide_id": "s3", "item_ids": ["curve"]}, "").content[0]
    assert text.startswith('[circled on slide s3] items=curve said="why minus?"')
    # derivations are worked by hand on the board, concepts get a richer animation
    assert 'show_tab("board")' in text and "derivation" in text
    assert "slide_animate(" in text and "curve" in text  # follow-up slide built from the circled objects
    assert "point_at" not in text  # slide objects are not board items


def test_screen_circle_keeps_plain_reexplain():
    text = circle_message({**PAYLOAD, "source": "screen"}, "").content[0]
    assert "start_visual" not in text and "point_at" not in text


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
