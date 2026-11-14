"""Failures must show up in the worker log: tool calls/results, session errors, background task crashes."""
import asyncio
import logging

from livekit.agents import AgentSession, llm
from livekit.agents.voice.events import ErrorEvent, FunctionToolsExecutedEvent

from agent import log_session, log_task_exception


async def test_tool_calls_and_results_logged(caplog):
    session = AgentSession()
    log_session(session)
    calls = [llm.FunctionCall(call_id="c1", name="board_write", arguments='{"ops": []}'),
             llm.FunctionCall(call_id="c2", name="start_visual", arguments="{}")]
    outs = [llm.FunctionCallOutput(call_id="c1", name="board_write", output="failed: " + "x" * 500, is_error=False),
            llm.FunctionCallOutput(call_id="c2", name="start_visual", output="boom", is_error=True)]
    with caplog.at_level(logging.INFO, logger="tutor"):
        session.emit("function_tools_executed", FunctionToolsExecutedEvent(function_calls=calls, function_call_outputs=outs))
    text = caplog.text
    assert "tool board_write" in text and "failed: xxx" in text and "x" * 300 not in text
    assert "tool start_visual" in text and "error" in text and "boom" in text


async def test_session_errors_logged_with_traceback(caplog):
    session = AgentSession()
    log_session(session)
    err = llm.LLMError(timestamp=0, error=RuntimeError("max_tokens hit"), recoverable=False, label="anthropic")
    with caplog.at_level(logging.INFO, logger="tutor"):
        session.emit("error", ErrorEvent(error=err, source="llm"))
    assert "session error" in caplog.text and "max_tokens hit" in caplog.text
    assert any(r.exc_info for r in caplog.records)


async def test_background_task_exception_logged(caplog):
    async def crash():
        raise ValueError("rpc exploded")

    task = asyncio.create_task(crash())
    task.add_done_callback(log_task_exception)
    with caplog.at_level(logging.INFO, logger="tutor"):
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)
    assert "background task failed" in caplog.text and "rpc exploded" in caplog.text


async def test_cancelled_task_not_logged(caplog):
    task = asyncio.create_task(asyncio.sleep(10))
    task.add_done_callback(log_task_exception)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await asyncio.sleep(0)
    assert "background task failed" not in caplog.text
