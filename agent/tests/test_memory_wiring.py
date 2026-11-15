"""Lesson memory: conversation items reach /end through the same wiring the live session uses."""
from livekit.agents import AgentSession, llm

from agent import track_turns
from lesson_end import LessonEnder, finish_lesson
from rolling import RollingSummary


class Post:
    def __init__(self):
        self.calls = []

    async def __call__(self, path, body):
        self.calls.append((path, body))
        return {}


def _session_with_turns(summarize):
    session = AgentSession()
    rolling = RollingSummary(summarize)
    folds = []
    track_turns(session, rolling, lambda said: folds.append(said))
    session._conversation_item_added(llm.ChatMessage(role="user", content=["What is a gradient?"]))
    session._conversation_item_added(llm.ChatMessage(role="assistant", content=["The slope of the loss."]))
    session._conversation_item_added(llm.ChatMessage(role="system", content=["Visual ready: x"]))
    return rolling, folds


async def test_session_items_reach_end_summary():
    async def summarize(prev, turns):
        return " | ".join(turns)

    rolling, folds = _session_with_turns(summarize)
    assert folds == ["The slope of the loss."]  # called after each tutor turn, with what the tutor said
    post = Post()
    await finish_lesson(rolling, LessonEnder(post, "L1"), [], summarize)
    assert post.calls[0][1]["summary"] == "user: What is a gradient? | assistant: The slope of the loss."


async def test_failed_final_summary_keeps_the_conversation():
    async def broken(prev, turns):
        raise RuntimeError("anthropic down")

    rolling, _ = _session_with_turns(broken)
    post = Post()
    await finish_lesson(rolling, LessonEnder(post, "L1"), [], broken)
    summary = post.calls[0][1]["summary"]
    assert summary != "(no conversation)" and "What is a gradient?" in summary


async def test_empty_final_summary_keeps_the_conversation():
    async def empty(prev, turns):
        return ""

    rolling, _ = _session_with_turns(empty)
    post = Post()
    await finish_lesson(rolling, LessonEnder(post, "L1"), [], empty)
    assert "The slope of the loss." in post.calls[0][1]["summary"]
