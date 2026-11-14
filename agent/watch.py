"""Watching the student's handwriting: "tutor.idle" events (they wrote, then stopped) become hints or
corrections. A fast Haiku vision check runs off the voice path; the board marks are drawn here (code owns the
effect), the voice brain only explains."""

import asyncio
import logging
import time
import uuid
import weakref

logger = logging.getLogger("tutor.watch")

RULES = """Watching the student's writing:
- A [watching] note means the student wrote on the board, paused, and a checker looked at it. Follow the note; keep it short and kind.
- Hint: one short spoken nudge toward the next step; never give the answer.
- Mistake: the wrong part is already circled in red and the correction written below it. Say in one or two sentences why it was wrong, pointing at the correction. Do not draw them again.
- When you check the student's answer yourself and it is wrong: circle the wrong part with annotate {mark:"circle", color:"red", target_id or region}, write the correction below it (write_math with place below:<id>), then explain briefly."""

MODEL = "claude-haiku-5-5"
MIN_GAP_S = 15.0  # at most one intervention per this many seconds
PAD = 12  # board units around the red circle
TOOL = {
    "name": "report_check",
    "description": "Report whether the student's handwritten working is fine, needs a hint, or has a mistake.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["ok", "hint", "mistake"]},
            "box": {
                "type": "object",
                "description": "For a mistake: where the wrong part is, as fractions (0-1) of the image width/height.",
                "properties": {k: {"type": "number"} for k in ("x", "y", "w", "h")},
                "required": ["x", "y", "w", "h"],
            },
            "say": {"type": "string", "description": "One short spoken sentence for the tutor: the hint, or what is wrong. No symbols."},
            "correction_latex": {"type": "string", "description": "For a mistake: the corrected line as LaTeX."},
        },
        "required": ["verdict", "say"],
    },
}
SYSTEM = (
    "You watch a student's handwritten working on a whiteboard during a live tutoring lesson. The image is the part "
    "they just wrote before pausing. Call report_check once. verdict 'ok' when the working is correct, on track but "
    "unfinished, unreadable, or not an attempt at the task; 'hint' when they seem stuck or are heading the wrong way "
    "without a wrong step yet; 'mistake' only for a clearly wrong step, with box around that step and correction_latex "
    "for the corrected line. When unsure, say ok: interrupting a correct student is worse than missing a slip."
)
_OK = {"verdict": "ok", "say": ""}
_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


async def check_handwriting(png_b64: str, mime: str, context: str, *, client=None, timeout_s: float = 6.0) -> dict:
    """Haiku looks at the student's recent ink; any failure counts as ok (stay silent)."""
    if client is None:
        import anthropic

        client = anthropic.AsyncAnthropic()  # ANTHROPIC_API_KEY from env
    try:
        resp = await asyncio.wait_for(
            client.messages.create(
                model=MODEL,
                max_tokens=400,
                system=SYSTEM,
                tools=[TOOL],
                tool_choice={"type": "tool", "name": TOOL["name"]},
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": mime, "data": png_b64}},
                    {"type": "text", "text": f"Lesson context:\n{context}"},
                ]}],
            ),
            timeout_s,
        )
        out = next(b.input for b in resp.content if b.type == "tool_use")
    except Exception:
        logger.warning("handwriting check failed", exc_info=True)
        return dict(_OK)
    if not isinstance(out, dict) or out.get("verdict") not in ("ok", "hint", "mistake"):
        return dict(_OK)
    return out


class _State:
    def __init__(self):
        self.last = float("-inf")  # time of the last intervention
        self.busy = False


_states: "weakref.WeakKeyDictionary[object, _State]" = weakref.WeakKeyDictionary()


def _busy(session) -> bool:
    return session.agent_state in ("speaking", "thinking") or getattr(session, "user_state", None) == "speaking"


def _clip(b: dict) -> dict:
    x, y = max(0, round(b["x"])), max(0, round(b["y"]))
    return {"x": x, "y": y, "w": max(1, min(1000, round(b["x"] + b["w"])) - x), "h": max(1, min(3000, round(b["y"] + b["h"])) - y)}


def _mistake_region(region: dict, box) -> dict:
    """The wrong part in board units: Haiku's box (fractions of the snapshot) mapped onto the snapshot region."""
    if isinstance(box, dict) and all(isinstance(box.get(k), (int, float)) for k in ("x", "y", "w", "h")):
        f = {k: min(1.0, max(0.0, float(box[k]))) for k in ("x", "y", "w", "h")}
        if f["w"] > 0 and f["h"] > 0:
            region = {"x": region["x"] + f["x"] * region["w"], "y": region["y"] + f["y"] * region["h"],
                      "w": f["w"] * region["w"], "h": f["h"] * region["h"]}
    return _clip({"x": region["x"] - PAD, "y": region["y"] - PAD, "w": region["w"] + 2 * PAD, "h": region["h"] + 2 * PAD})


def _context(agent, board: str) -> str:
    said = next((m.text_content or "" for m in reversed(agent.chat_ctx.items)
                 if m.type == "message" and m.role == "assistant"), "")
    return f'Tutor last said: "{said[-300:]}"\nWhiteboard items:\n{board}'


async def handle_idle(agent, session, tools, payload: dict, *, check=check_handwriting, now=time.monotonic) -> None:
    """payload is an IdleEvent (frontend/src/tutor/contracts/types.ts)."""
    region = payload.get("region")
    if not payload.get("png_b64") or not isinstance(region, dict):
        logger.info("idle: ignored (no image or region)")
        return
    st = _states.setdefault(session, _State())
    if _busy(session):
        logger.info("idle: skipped, tutor is %s", session.agent_state)
        return
    if st.busy or now() - st.last < MIN_GAP_S:
        logger.info("idle: skipped (%s)", "check running" if st.busy else "rate limit")
        return
    st.busy = True
    try:
        try:
            board = await tools.board_text()
        except Exception as e:
            board = f"(board unavailable: {e})"
        mime = payload.get("mime") if payload.get("mime") in _MIMES else "image/png"
        result = await check(payload["png_b64"], mime, _context(agent, board))
        verdict, say = result.get("verdict"), str(result.get("say") or "")
        logger.info("idle: verdict %s %r", verdict, say[:120])
        if verdict not in ("hint", "mistake"):
            return
        if _busy(session):  # the tutor started talking while we checked: never talk over them
            logger.info("idle: %s dropped, tutor is %s", verdict, session.agent_state)
            return
        st.last = now()
        if verdict == "hint":
            session.generate_reply(instructions=(
                f"[watching] The student paused while writing their answer. Give one short spoken hint, "
                f"not the answer: {say}"))
            return
        await _correct(session, tools, region, result, say)
    finally:
        st.busy = False


async def _correct(session, tools, region: dict, result: dict, say: str) -> None:
    tag = uuid.uuid4().hex[:6]
    mark = _mistake_region(region, result.get("box"))
    ops = [{"op": "annotate", "id": f"fix_mark_{tag}", "mark": "circle", "region": mark, "color": "red"}]
    latex = str(result.get("correction_latex") or "").strip()
    if latex:
        below = _clip({"x": mark["x"], "y": mark["y"] + mark["h"] + 10, "w": max(mark["w"], 240), "h": 70})
        ops.append({"op": "write_math", "id": f"fix_{tag}", "latex": latex,
                    "place": f"region:{below['x']},{below['y']},{below['w']},{below['h']}"})
    drawn = await tools.board_write(ops)
    logger.info("idle: correction ops %s", drawn[:200])
    if drawn.startswith("ok"):
        board = f"The wrong part is circled in red (fix_mark_{tag})" + (f" and the correction is written below it (fix_{tag})" if latex else "")
        how = f"Point at fix_{tag} while you explain. " if latex else ""
    else:
        board, how = "Drawing the correction failed", f"Explain it in words{': the right line is ' + latex if latex else ''}. "
    session.generate_reply(instructions=(
        f"[watching] The student made a mistake in what they just wrote: {say}. {board}. {how}"
        "Say in one or two short sentences what went wrong and why; do not redraw it."))
