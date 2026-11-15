"""Circle ("tutor.circle") and "I'm lost" ("tutor.lost") page events become new user turns."""

import asyncio
import logging

from livekit.agents import llm

logger = logging.getLogger("tutor.circle")


# v3: a circle never triggers an instant lecture. The turn only asks what is unclear; the explanation comes after
# the student answers, in place (same slide / same board). v3.1: the mark clears as the explanation starts.
EXPLAIN = {
    "board": "write the whole working first with board_write next to what I circled (say one short sentence like "
             "\"let me write it out\" while it writes), then explain it line by line, tagging each line and the circled "
             "items as you reach them ({tags})",
    # slide_animate opens a new slide, which loses my context: only for ideas that are not on this slide
    "slide": "explain it on this same slide: call slide_edit(brief=..., object_ids=[{items}]) and walk me through the "
             "new steps it reports with slide_step. Only if what I ask about is not on this slide at all, use "
             "slide_animate for a new slide",
    "screen": "re-explain it in a different way than what's already shown",
}


class PendingCircle:
    """The student's open circle. Code clears it when the explanation starts (slide_edit / board_write), so it never
    lingers while the student is answering or listening."""

    def __init__(self, io):
        self.io = io
        self.id: str | None = None
        self.source = ""

    def open(self, payload: dict) -> None:
        self.id, self.source = payload.get("circle_id"), payload.get("source") or "board"

    async def clear(self, source: str) -> bool:
        """Clear the open circle if it is on `source` ("slide" or "board"); True if the page cleared it."""
        if not self.id or self.source != source:
            return False
        cid, self.id = self.id, None
        try:
            return bool((await self.io.rpc("ui.clear_circle", {"circle_id": cid})).get("ok"))
        except Exception as e:
            logger.warning("clearing circle %s failed: %s", cid, e)
            return False


def circle_message(payload: dict, board_text: str) -> llm.ChatMessage:
    ids = payload.get("item_ids") or []
    source = payload.get("source") or "board"
    where = f"slide {payload['slide_id']}" if source == "slide" and payload.get("slide_id") else source
    cid = payload.get("circle_id")
    explain = (EXPLAIN.get(source, EXPLAIN["screen"]).replace("{items}", ", ".join(repr(i) for i in ids))
               .replace("{tags}", ", ".join(f"[[{i}]]" for i in ids) or "[[item_id]]"))
    if source in ("board", "slide"):
        explain += " (my circle clears by itself as you start)"
    elif cid:
        explain = f'call clear_circle("{cid}") and {explain}'
    text = (
        f'[circled on {where}] circle_id={cid or "none"} items={", ".join(ids) or "none"} '
        f'said="{payload.get("user_text") or ""}" board:\n{board_text}\n'
        "Don't explain yet. In one short sentence say what I circled and ask what about it is unclear (skip the "
        "question if my words above already say it), then stop and wait for my answer. "
        f"After I answer, {explain}. Then ask if that helped."
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
