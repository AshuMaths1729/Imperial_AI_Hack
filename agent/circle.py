"""Circle ("tutor.circle") and "I'm lost" ("tutor.lost") page events become new user turns."""

import asyncio
import logging

from livekit.agents import llm

logger = logging.getLogger("tutor.circle")


REEXPLAIN = "Re-explain what I circled in a different way than what's already on the board."
ASK = {
    "board": f"{REEXPLAIN} While you explain, point_at the circled item (or annotate it) so I see what you mean.",
    "screen": REEXPLAIN,
    # the model judges derivation vs concept; both branches name the exact tools so the routing stays predictable
    "slide": (
        "Explain what I circled on the slide more richly. If it is a derivation, calculation or worked step: "
        'call show_tab("board") and work it by hand on the board, one line per step. Otherwise: call '
        'start_visual(kind="animation", brief=...) for a richer animation of exactly what I circled, then '
        'show_tab("board") so I watch it appear, and talk me through it while it builds. Say one short sentence first.'
    ),
}


def circle_message(payload: dict, board_text: str) -> llm.ChatMessage:
    items = ", ".join(payload.get("item_ids") or []) or "none"
    source = payload.get("source") or "board"
    where = f"slide {payload['slide_id']}" if source == "slide" and payload.get("slide_id") else source
    text = (
        f'[circled on {where}] items={items} said="{payload.get("user_text") or ""}" board:\n'
        f"{board_text}\n{ASK.get(source, REEXPLAIN)}"
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
    logger.info("circle from %s: items=%s, image %d chars, tutor %s", payload.get("source"), payload.get("item_ids"),
                len(payload.get("png_b64") or ""), session.agent_state)
    await _interrupt(session)
    await _new_turn(agent, session, circle_message(payload, board_text))


async def handle_lost(agent, session) -> None:
    await _interrupt(session)
    last = next(
        (m.text_content or "" for m in reversed(agent.chat_ctx.items) if m.type == "message" and m.role == "assistant"),
        "",
    )
    await _new_turn(agent, session, lost_message(last))
