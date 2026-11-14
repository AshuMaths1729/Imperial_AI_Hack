from livekit.agents import llm

from circle import circle_message, handle_circle, handle_lost, lost_message

PAYLOAD = {"png_b64": "AAAA", "region": {"x": 1, "y": 2, "w": 3, "h": 4}, "item_ids": ["eq1", "u1"], "user_text": "why minus?"}


def test_circle_message_has_image_and_items():
    msg = circle_message(PAYLOAD, "eq1 math tutor: x^2")
    assert msg.role == "user"
    text, image = msg.content
    assert text.startswith('[circled on board] items=eq1, u1 said="why minus?" board:\neq1 math tutor: x^2\n')
    assert text.endswith("Re-explain what I circled in a different way than what's already on the board.")
    assert isinstance(image, llm.ImageContent) and image.image == "data:image/png;base64,AAAA"


def test_circle_message_without_items_says_none():
    text = circle_message({"png_b64": "A", "region": {}, "item_ids": []}, "")
    assert 'items=none said=""' in text.content[0]


def test_circle_message_names_screen_source():
    assert circle_message({**PAYLOAD, "source": "screen"}, "").content[0].startswith("[circled on screen]")


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
