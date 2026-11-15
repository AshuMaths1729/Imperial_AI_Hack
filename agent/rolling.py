"""Rolling lesson context: last N turns verbatim + a running summary folded in the background."""

from collections.abc import Awaitable, Callable

import anthropic


class RollingSummary:
    def __init__(self, summarize: Callable[[str, list[str]], Awaitable[str]], keep_last: int = 10, fold_every: int = 6):
        self._summarize = summarize
        self.keep_last = keep_last
        self.fold_every = fold_every
        self.summary = ""
        self.recent: list[str] = []
        self._folding = False

    def add_turn(self, role: str, text: str) -> None:
        self.recent.append(f"{role}: {text}")

    async def maybe_fold(self) -> bool:
        if self._folding or len(self.recent) <= self.keep_last + self.fold_every:
            return False
        self._folding = True
        try:
            n_old = len(self.recent) - self.keep_last
            self.summary = await self._summarize(self.summary, self.recent[:n_old])
            self.recent = self.recent[n_old:]  # turns added during the await are kept
            return True
        finally:
            self._folding = False


_client: anthropic.AsyncAnthropic | None = None


async def haiku_summarize(prev: str, turns: list[str]) -> str:
    global _client
    _client = _client or anthropic.AsyncAnthropic()
    resp = await _client.messages.create(
        model="claude-haiku-5-5",
        max_tokens=200,
        system="You keep a running summary of a tutoring lesson. Reply with the updated summary only: "
        "what was covered, what the student struggled with, which explanations and which picture or analogy per "
        "concept worked. Under 120 words.",
        messages=[{
            "role": "user",
            "content": f"Summary so far:\n{prev or '(none)'}\n\nNew turns:\n" + "\n".join(turns),
        }],
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()
