"""Board, screen and progress tools for the tutor. Plain async methods (tested) + LiveKit function tools."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal, Protocol, TypedDict

import httpx
from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match
from livekit.agents import llm

logger = logging.getLogger("tutor.tools")

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "frontend/src/tutor/contracts/board_ops.schema.json"
_SCHEMA = json.loads(SCHEMA_PATH.read_text())
_validator = Draft202012Validator(_SCHEMA)
BOARD_WRITE_PARAMS = {k: v for k, v in _SCHEMA.items() if k in ("type", "required", "properties", "$defs")}


class TutorIO(Protocol):
    async def rpc(self, method: str, payload: dict) -> dict: ...
    async def post(self, path: str, body: dict) -> dict: ...
    def latest_screen_frame(self) -> str | None: ...


class Box(TypedDict):
    x: float
    y: float
    w: float
    h: float


def as_tool_output(result: str | tuple[str, str] | tuple[str, str, str], media_type: str) -> str:
    """Tool outputs are strings; a JSON list is passed through as Anthropic tool_result content blocks.
    A third tuple element overrides media_type (the board snapshot says its own mime)."""
    if isinstance(result, str):
        return result
    text, b64, *mime = result
    media_type = mime[0] if mime else media_type
    return json.dumps([
        {"type": "text", "text": text},
        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
    ])


def _op_error(i: int, op: Any) -> str | None:
    err = best_match(_validator.iter_errors({"ops": [op]}))
    if err is None:
        return None
    name = op.get("op") if isinstance(op, dict) else None
    return f"op {i} ({name}): {err.message[:160]}"


def visible_ops(ops: list) -> list:
    """The tutor writes its working visibly, then explains it with the laser: no hidden steps to reveal while talking.
    (The background animation worker keeps stepped reveals; it calls TutorTools.board_write directly.)"""
    return [{k: v for k, v in op.items() if k not in ("step", "group")} if isinstance(op, dict) else op
            for op in ops if not (isinstance(op, dict) and op.get("op") == "reveal_step")]


class TutorTools:
    def __init__(self, io: TutorIO, lesson_id: str, on_note: Callable[[str], Awaitable[None]] | None = None,
                 circle=None):
        self.io = io
        self.lesson_id = lesson_id
        self.on_note = on_note  # tells the tutor's chat context something happened (e.g. a visual arrived)
        self.circle = circle  # circle.PendingCircle (or None): a board explanation clears the student's board circle
        self.covered: list[str] = []  # KPs marked during this lesson, sent with /end
        self._tasks: set[asyncio.Task] = set()

    async def board_write(self, ops: list[dict]) -> str:
        errors, valid = [], []
        for i, op in enumerate(ops):
            if e := _op_error(i, op):
                errors.append(e)
            else:
                valid.append(op)
        ids: list[str] = []
        if valid:
            try:
                reply = await self.io.rpc("board.apply", {"ops": valid})
                ids = [str(i) for i in reply.get("ids") or []]
                errors += [str(e) for e in reply.get("errors") or []]
                if not reply.get("ok") and not errors:
                    errors.append("board rejected the ops")
            except Exception as e:
                errors.append(f"board unreachable: {e}")
        if not errors:
            lines = [op["id"] for op in valid if op["op"] in ("write_math", "write_text") and op.get("id")]
            # v3.2 G6: one line per write, explained with the laser before the next; slides again when done
            then = ' When the working is done, show_tab("slides").'
            if len(lines) > 1:
                return (f"ok: drew {', '.join(ids)}. Explain them line by line, tagging each as you reach it "
                        f"([[{lines[0]}]] ...); from now on write one line per board_write.{then}")
            if lines:
                return (f"ok: drew {', '.join(ids)}. Explain this line now, starting with [[{lines[0]}]] and tagging its "
                        f"parts; then board_write the next line.{then}")
            return f"ok: drew {', '.join(ids)}"
        if ids:
            return f"partial: drew {', '.join(ids)}; failed: {'; '.join(errors)}"
        return f"failed: {'; '.join(errors)}"

    async def board_text(self) -> str:
        reply = await self.io.rpc("board.describe", {})
        items = reply.get("items")
        if reply.get("ok") is False or not isinstance(items, list):
            why = "; ".join(str(e) for e in reply.get("errors") or []) or "no items returned"
            return f"couldn't read the board: {why}"
        lines = [
            f"{it['id']} {it['type']} {it['author']}: {it.get('text') or it.get('latex') or it.get('label') or ''}"
            for it in items
        ]
        return "\n".join(lines) or "(board is empty)"

    async def look_at_board(self, region: dict | None = None) -> str | tuple[str, str, str]:
        try:
            text = await self.board_text()
            if region is None:
                return text
            # reply {png_b64, mime?} (mime absent = png; the page may send JPEG to fit the 15 KB RPC limit)
            snap = await self.io.rpc("board.snapshot", {"region": region})
            if snap.get("ok") is False or not snap.get("png_b64"):
                why = "; ".join(str(e) for e in snap.get("errors") or []) or "no image returned"
                return f"{text}\n(couldn't capture the board: {why})"
            return text, snap["png_b64"], snap.get("mime") or "image/png"
        except Exception as e:
            return f"failed: could not read the board ({e})"

    async def look_at_screen(self) -> str | tuple[str, str]:
        frame = self.io.latest_screen_frame()
        if frame is None:
            return "no screen is being shared"
        return "latest frame of the student's shared screen", frame

    async def _progress(self, body: dict, kp_id: str) -> str | None:
        """Returns an error string, or None on success."""
        try:
            await self.io.post(f"/api/lesson/lessons/{self.lesson_id}/progress", body)
            return None
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return f"failed: unknown kp {kp_id}"
            return f"failed: {e}"
        except Exception as e:
            return f"failed: {e}"

    async def mark_progress(self, kp_id: str, status: Literal["introduced", "understood"], evidence: str) -> str:
        body = {"kp_updates": [{"kp_id": kp_id, "status": status, "evidence": evidence}]}
        if err := await self._progress(body, kp_id):
            return err
        if kp_id not in self.covered:
            self.covered.append(kp_id)
        return f"ok: {kp_id} {status}"

    async def note_struggle(self, kp_id: str, what: str, tried: list[str]) -> str:
        body = {"struggles": [{"kp_id": kp_id, "what": what, "tried_explanations": tried}]}
        return await self._progress(body, kp_id) or "ok: noted"

    async def note_worked(self, kp_id: str, style: str) -> str:
        body = {"worked": [{"kp_id": kp_id, "explanation_style": style}]}
        return await self._progress(body, kp_id) or "ok: noted"

    async def start_visual(self, kind: Literal["illustration", "animation"], brief: str) -> str:
        try:
            from workers import is_fallback, run_visual  # agent/workers (WS5), optional
        except ImportError:
            return "not available"
        task = asyncio.create_task(self._run_visual(run_visual, is_fallback, kind, brief))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return "queued"

    async def _run_visual(self, run_visual, is_fallback, kind: str, brief: str) -> None:
        note = f"Visual unavailable: {brief} — explain it in words or draw it yourself with board_write"
        try:
            ops = await run_visual(kind, brief, await self.board_text())
            result = await self.board_write(ops)
            logger.info("visual %s: %s", kind, result)
            if not result.startswith("failed") and not is_fallback(ops):
                note = f"Visual ready: {brief}"
                stepped = [op for op in ops if op.get("group") and op.get("step")]
                if stepped:
                    note += (f" (group {stepped[0]['group']}, steps 1..{max(op['step'] for op in stepped)}; "
                             "reveal later steps with reveal_step as you explain)")
        except Exception:
            logger.exception("visual %s failed", kind)
        if self.on_note is not None:
            try:
                await self.on_note(note)
            except Exception:
                logger.exception("visual note failed")

    def function_tools(self) -> list[llm.FunctionTool | llm.RawFunctionTool]:
        t = self

        # Raw (non-strict) tool: Anthropic strict mode rejects free-form op objects, and this way the model
        # sees the exact board-op contract.
        @llm.function_tool(raw_schema={
            "name": "board_write",
            "description": "Draw or change things on the shared whiteboard, in order. Board units: x 0-1000, y 0-3000 (the page "
            "grows downward like paper), never pixels. Give items short ids so you can refer to them (below:<id>, right_of:<id>, arrows). "
            "Ops with `step` are HIDDEN until you send reveal_step {group_id, step}; every stepped op needs a "
            "`group`; reveal step 1 in the same call, then later steps as you talk. "
            "plot_function expr uses x as the variable, * for multiplication and ^ for powers, with sin, cos, tan, "
            "exp, log (natural), sqrt, abs, PI, E, e.g. x^2 or exp(-0.3*x)*cos(2*x).",
            "parameters": BOARD_WRITE_PARAMS,
        })
        async def board_write(raw_arguments: dict[str, Any]) -> str:
            # the explanation starts: the student's board circle goes (v3.1 F2)
            cleared = t.circle is not None and await t.circle.clear("board")
            out = await t.board_write(visible_ops(raw_arguments.get("ops") or []))
            return out + (" The student's circle is cleared." if cleared else "")

        @llm.function_tool
        async def look_at_board(region: Box | None = None) -> str:
            """Read what is on the whiteboard (id, type, author, content). Pass a region (board units) to also see an image of it, e.g. to check the student's handwritten answer.

            Args:
                region: optional area to look at as an image
            """
            box = {k: round(v) for k, v in region.items()} if region else None
            return as_tool_output(await t.look_at_board(box), "image/png")

        @llm.function_tool
        async def look_at_screen() -> str:
            """See the latest frame of the screen the student is sharing."""
            return as_tool_output(await t.look_at_screen(), "image/jpeg")

        @llm.function_tool
        async def mark_progress(kp_id: str, status: Literal["introduced", "understood"], evidence: str) -> str:
            """Record that a knowledge point was introduced or understood.

            Args:
                kp_id: knowledge point id from the list, e.g. m0:n1
                status: introduced or understood
                evidence: one short sentence on why
            """
            return await t.mark_progress(kp_id, status, evidence)

        @llm.function_tool
        async def note_struggle(kp_id: str, what: str, tried: list[str]) -> str:
            """Record what the student struggled with and which explanation styles you already tried.

            Args:
                kp_id: knowledge point id
                what: what they found hard, a few words
                tried: styles tried so far, e.g. ["analogy", "diagram"]
            """
            return await t.note_struggle(kp_id, what, tried)

        @llm.function_tool
        async def note_worked(kp_id: str, style: str) -> str:
            """Record the explanation style that made a knowledge point click.

            Args:
                kp_id: knowledge point id
                style: e.g. analogy, diagram, worked example
            """
            return await t.note_worked(kp_id, style)

        @llm.function_tool
        async def start_visual(kind: Literal["illustration", "animation"], brief: str) -> str:
            """Start a slow visual in the background (an illustration image or a multi-step animation). It appears on the board in a few seconds; say "let me sketch that" and keep talking.

            Args:
                kind: illustration or animation
                brief: one or two sentences describing what to show
            """
            return await t.start_visual(kind, brief)

        return [board_write, look_at_board, look_at_screen, mark_progress, note_struggle, note_worked, start_visual]
