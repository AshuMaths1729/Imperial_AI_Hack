"""Speech-synced laser (v3.1 F1). The tutor writes [[object_id]] right before the word(s) it is talking about. The
tags are stripped from the text the TTS gets (so they are never spoken, captioned or kept in chat history), and the
page gets the cue script RPC ui.point_cues {cues: [{word, id}]} just before that speech's first caption word; it
points at `id` when caption word `word` (0-based, counted from that speech's first word) is spoken.

One reply step is one speech segment: its tts_node (strip, collect cues) and its transcription_node (captions)
are paired per speech handle, in order."""

import asyncio
import logging
import re
import weakref
from collections import deque
from typing import AsyncIterable, AsyncIterator, Awaitable, Callable

from livekit.agents.voice.io import TimedString

logger = logging.getLogger("tutor.cues")

TAG = re.compile(r"\[\[([^\[\]]{1,64})\]\]")
TAG_START = re.compile(r"\[(?:\[[^\[\]]{0,64}\]?)?")  # what a tag cut off by a chunk boundary can look like
CUE_WAIT_S = 1.5  # captions wait at most this long for the speech text to finish (all its tags known)


class TagStripper:
    """Streaming tag remover: feed() chunks, then flush(). `cues` lists {word, id}, word = index in the output."""

    def __init__(self):
        self.pending = ""  # text that may be the start of a tag
        self.said = ""  # everything let through so far
        self.cues: list[dict] = []
        self._after_tag = False

    def _out(self, text: str) -> str:
        if self._after_tag and text:
            if not self.said or self.said[-1].isspace():
                text = text.lstrip()  # "the [[rise]] rise" -> "the rise", not "the  rise"
            self._after_tag = not text
        self.said += text
        return text

    def feed(self, chunk: str) -> str:
        self.pending += chunk
        out = ""
        while (i := self.pending.find("[")) >= 0:
            out += self._out(self.pending[:i])
            rest = self.pending[i:]
            if m := TAG.match(rest):
                self.cues.append({"word": len(self.said.split()), "id": m[1].strip()})
                self._after_tag = True
                self.pending = rest[m.end():]
            elif TAG_START.fullmatch(rest):
                self.pending = rest  # wait for the next chunk
                return out
            else:
                out += self._out("[")
                self.pending = rest[1:]
        out += self._out(self.pending)
        self.pending = ""
        return out

    def flush(self) -> str:
        rest, self.pending = self.pending, ""
        return self._out(rest)  # an unfinished "[[..." is not a tag


class _Segment:
    def __init__(self):
        self.tags = TagStripper()
        self.done = asyncio.Event()  # the speech text has ended (all tags known)


class _NoSpeech:  # key for text spoken outside a speech handle (weakref-able, unlike object())
    pass


_NO_SPEECH = _NoSpeech()


def current_speech():
    """The SpeechHandle whose reply is running (LiveKit sets it for the reply task and its TTS/caption nodes)."""
    try:
        from livekit.agents.voice.agent_activity import _SpeechHandleContextVar  # private in 1.8; fall back if gone
    except ImportError:
        return _NO_SPEECH
    return _SpeechHandleContextVar.get(None) or _NO_SPEECH


class SpeechCues:
    def __init__(self, rpc: Callable[[str, dict], Awaitable[dict]], key: Callable[[], object] = current_speech):
        self.rpc = rpc
        self.key = key
        self._segments: "weakref.WeakKeyDictionary[object, deque[_Segment]]" = weakref.WeakKeyDictionary()
        self._tasks: set[asyncio.Task] = set()

    def tts_text(self, text: AsyncIterable[str]) -> AsyncIterator[str]:
        """For tts_node: the speech text without tags (the cues are kept for this segment's captions)."""
        seg = _Segment()
        self._segments.setdefault(self.key(), deque()).append(seg)
        return self._strip(text, seg)

    @staticmethod
    async def _strip(text: AsyncIterable[str], seg: _Segment) -> AsyncIterator[str]:
        try:
            async for chunk in text:
                if out := seg.tags.feed(chunk):
                    yield out
            if out := seg.tags.flush():
                yield out
        finally:
            seg.done.set()

    def captions(self, text: AsyncIterable[str | TimedString]) -> AsyncIterator[str | TimedString]:
        """For transcription_node: sends this segment's cues before its first caption word; strips tags from a
        raw-text transcript (no TTS alignment)."""
        queue = self._segments.get(self.key())
        return self._captions(text, queue.popleft() if queue else None)

    async def _captions(self, text, seg: _Segment | None):
        raw = TagStripper()
        first = True
        async for chunk in text:
            if first:
                first = False
                await self._send(seg)
            if isinstance(chunk, TimedString):
                yield chunk  # TTS-aligned: already the stripped text the TTS spoke
            elif out := raw.feed(chunk):
                yield out
        if out := raw.flush():
            yield out

    async def _send(self, seg: _Segment | None) -> None:
        if seg is None:
            return
        try:
            await asyncio.wait_for(seg.done.wait(), CUE_WAIT_S)
        except asyncio.TimeoutError:
            # shortcut: tags after this point (text still streaming, e.g. a long tool call) get no cue
            logger.info("speech text still streaming; sending the %d cue(s) found so far", len(seg.tags.cues))
        if cues := list(seg.tags.cues):
            task = asyncio.create_task(self._point(cues))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            await asyncio.sleep(0)  # the request goes out before the first caption word

    async def _point(self, cues: list[dict]) -> None:
        logger.info("laser cues: %s", cues)
        try:
            await self.rpc("ui.point_cues", {"cues": cues})
        except Exception as e:
            logger.warning("laser cues not delivered: %s", e)
