"""Circle ("tutor.circle") and "I'm lost" ("tutor.lost") page events become new user turns."""

import asyncio
import logging

from livekit.agents import llm

logger = logging.getLogger("tutor.circle")


def circle_message(payload: dict, board_text: str) -> llm.ChatMessage:
    items = ", ".join(payload.get("item_ids") or []) or "none"
    text = (
        f'[circled on {payload.get("source") or "board"}] items={items} said="{payload.get("user_text") or ""}" board:\n'
        f"{board_text}\nRe-explain what I circled in a different way than what's already on the board."
    )
    image = llm.ImageContent(image=f"data:image/png;base64,{payload['png_b64']}")
    return llm.ChatMessage(role="user", content=[text, image])


def lost_message(last_spoken: str) -> llm.ChatMessage:
    text = (
        f'[I\'m lost] You were saying: "{last_spoken[-200:]}". I got lost there. '
        "Check what I'm missing and explain it differently."
    )
    return llm.ChatMessage(role="user", content=[text])


async def _interrupt(session) -> None:
    if session.agent_state not in ("speaking", "thinking"):
        return
    try:
        # resolves once the spoken part is committed to chat history
        await asyncio.wait_for(session.interrupt(), 2)
    except (RuntimeError, asyncio.TimeoutError) as e:
        logger.warning("interrupt failed: %s", e)


async def _new_turn(agent, session, msg: llm.ChatMessage) -> None:
    # generate_reply(user_input=...) keeps only the text, so the image needs the chat context route
    ctx = agent.chat_ctx.copy()
    ctx.items.append(msg)
    await agent.update_chat_ctx(ctx)
    session.generate_reply()


async def handle_circle(agent, session, payload: dict, board_text: str) -> None:
    await _interrupt(session)
    await _new_turn(agent, session, circle_message(payload, board_text))


async def handle_lost(agent, session) -> None:
    await _interrupt(session)
    last = next(
        (m.text_content or "" for m in reversed(agent.chat_ctx.items) if m.type == "message" and m.role == "assistant"),
        "",
    )
    await _new_turn(agent, session, lost_message(last))
