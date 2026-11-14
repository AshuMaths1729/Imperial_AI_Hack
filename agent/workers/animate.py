"""Animation planner: Claude Sonnet plans 3-6 grouped board ops; we validate and append reveal_step ops."""
import asyncio
import json
import logging
import uuid
from pathlib import Path

import jsonschema

log = logging.getLogger(__name__)
MODEL = "claude-sonnet-5-5"
SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend/src/tutor/contracts/board_ops.schema.json").read_text()
)
_VALIDATOR = jsonschema.Draft202012Validator(SCHEMA)
UNAVAILABLE = [{"op": "write_text", "text": "(animation unavailable)", "place": "next"}]
# The model must not emit these: reveals are generated here, the rest would act on the live board.
_NOT_FROM_MODEL = {"reveal_step", "erase", "clear_tutor_layer", "highlight"}

TOOL = {
    "name": "plan_animation",
    "description": "Submit the whiteboard ops for the animation, in drawing order.",
    "input_schema": {k: v for k, v in SCHEMA.items() if k not in ("$schema", "$id")},
}
SYSTEM = (
    "You plan a short step-by-step whiteboard animation for a live tutor. Call plan_animation once with "
    "3 to 6 steps. Every op belongs to a step: set integer `step` (1, 2, 3, ...) on each op, in teaching order; "
    "ops of the same step appear together. Give every op that later ops reference an `id`. Use 'next' for "
    "placement unless an id is available (below:ID, right_of:ID). Keep text short; use write_math for equations. "
    "Never reference ids that you did not create or that are not on the board. Do not use highlight/erase."
)


async def animate(brief: str, board_text: str, *, client=None, timeout_s: float = 8.0) -> list[dict]:
    if client is None:
        import anthropic

        client = anthropic.AsyncAnthropic()  # ANTHROPIC_API_KEY from env
    try:
        resp = await asyncio.wait_for(
            client.messages.create(
                model=MODEL,
                max_tokens=2000,
                system=SYSTEM,
                tools=[TOOL],
                tool_choice={"type": "tool", "name": TOOL["name"]},
                messages=[{"role": "user", "content": f"Animation to make: {brief}\n\nCurrent board:\n{board_text}"}],
            ),
            timeout_s,
        )
        raw = next(b.input for b in resp.content if b.type == "tool_use")["ops"]
    except Exception:  # timeout, API error, or no tool call: the tutor just says it can't
        log.warning("animate failed", exc_info=True)
        return list(UNAVAILABLE)
    group = "anim_" + uuid.uuid4().hex[:8]
    ops = []
    for op in raw if isinstance(raw, list) else []:
        if not isinstance(op, dict) or op.get("op") in _NOT_FROM_MODEL:
            continue
        op = {**op, "group": group} if "step" in op else dict(op)
        if _VALIDATOR.is_valid({"ops": [op]}):
            ops.append(op)
    if not ops:
        return list(UNAVAILABLE)
    steps = sorted({op["step"] for op in ops if "step" in op})
    return ops + [{"op": "reveal_step", "group_id": group, "step": s} for s in steps]
