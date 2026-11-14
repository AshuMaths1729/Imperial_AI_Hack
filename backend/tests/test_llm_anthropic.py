"""AnthropicLLM with a fake SDK: request shape, cache modes, refusal / truncation / validation."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from app.core.cache import FileCacheStore, MemoryCacheStore
from app.core.errors import (
    LLMRefusal,
    LLMTruncated,
    OfflineCacheMiss,
    SchemaValidationError,
)
from app.llm.anthropic_client import AnthropicLLM, cache_key
from app.llm.client import LLMClient, ParseRequest
from app.settings import Settings


class Answer(BaseModel):
    title: str
    score: int


def _resp(text: str = "", stop: str = "end_turn", **usage: int):
    blocks = [SimpleNamespace(type="text", text=text)] if text else []
    u = SimpleNamespace(
        input_tokens=usage.get("i", 10),
        output_tokens=usage.get("o", 5),
        cache_read_input_tokens=0,
        cache_creation_input_tokens=0,
    )
    return SimpleNamespace(content=blocks, stop_reason=stop, usage=u, model="claude-opus-5-5")


def _ok(title: str = "t", score: int = 1):
    return _resp(json.dumps({"title": title, "score": score}))


class FakeAnthropic:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def make(*responses, cache=None, **settings_kw):
    sdk = FakeAnthropic(*responses)
    settings = Settings(_env_file=None, **settings_kw)
    llm = AnthropicLLM(settings, cache or MemoryCacheStore(), client_factory=lambda: sdk)
    return llm, sdk


def test_implements_protocol():
    llm, _ = make()
    assert isinstance(llm, LLMClient)


async def test_request_shape():
    llm, sdk = make(_ok("hello", 3))
    res = await llm.parse("ask", "SYSTEM", "what is this?", Answer)
    assert res.output == Answer(title="hello", score=3)
    assert res.cached is False
    assert res.usage.input_tokens == 10 and res.usage.output_tokens == 5

    (call,) = sdk.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["system"] == "SYSTEM"
    assert call["max_tokens"] == 16000
    assert call["output_config"]["effort"] == "low"  # route "ask"
    fmt = call["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    assert set(fmt["schema"]["properties"]) == {"title", "score"}
    assert call["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "what is this?"}]}
    ]
    # parameters newer models reject must never be sent
    for forbidden in ("temperature", "tool_choice", "thinking", "top_p", "top_k"):
        assert forbidden not in call
    assert call["messages"][-1]["role"] == "user"  # no assistant prefill


async def test_effort_and_model_per_route():
    llm, sdk = make(_ok(), effort_extract="high", model_extract="claude-test-model")
    await llm.parse("lecture.extract", "p", "c", Answer, max_tokens=123)
    call = sdk.calls[0]
    assert call["model"] == "claude-test-model"
    assert call["output_config"]["effort"] == "high"
    assert call["max_tokens"] == 123


async def test_content_blocks_passed_through():
    blocks = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
        {"type": "text", "text": "question"},
    ]
    llm, sdk = make(_ok())
    await llm.parse("ask", "p", blocks, Answer)
    assert sdk.calls[0]["messages"][0]["content"] == blocks


async def test_cache_hit_skips_second_call():
    llm, sdk = make(_ok("first"), _ok("second"), _ok("third"))
    a = await llm.parse("ask", "p", "c", Answer)
    b = await llm.parse("ask", "p", "c", Answer)
    assert len(sdk.calls) == 1
    assert a.cached is False and b.cached is True
    assert b.output == a.output
    # a different prompt / content / version is a different entry
    await llm.parse("ask", "p", "other", Answer)
    await llm.parse("ask", "p", "c", Answer, prompt_version="v2")
    assert len(sdk.calls) == 3


async def test_offline_mode_cache_only(tmp_path):
    cache = FileCacheStore(tmp_path)
    live, _ = make(_ok("recorded"), cache=cache)
    await live.parse("ask", "p", "c", Answer)

    off, sdk = make(cache=cache, cache_mode="offline")
    hit = await off.parse("ask", "p", "c", Answer)
    assert hit.cached and hit.output.title == "recorded"
    with pytest.raises(OfflineCacheMiss):
        await off.parse("ask", "p", "never-seen", Answer)
    assert sdk.calls == []


async def test_refresh_mode_always_calls_and_overwrites():
    cache = MemoryCacheStore()
    llm, sdk = make(_ok("old"), _ok("new"), cache=cache, cache_mode="refresh")
    await llm.parse("ask", "p", "c", Answer)
    res = await llm.parse("ask", "p", "c", Answer)
    assert len(sdk.calls) == 2 and res.output.title == "new" and not res.cached
    # the refreshed value is what a later live-mode client reads
    reader, sdk2 = make(cache=cache)
    assert (await reader.parse("ask", "p", "c", Answer)).output.title == "new"
    assert sdk2.calls == []


async def test_refusal_maps_to_llm_refusal():
    llm, _ = make(_resp("", stop="refusal"))
    with pytest.raises(LLMRefusal):
        await llm.parse("ask", "p", "c", Answer)


async def test_truncation_retries_once_with_larger_limit():
    llm, sdk = make(_resp('{"title": "cut', stop="max_tokens"), _ok("done"))
    res = await llm.parse("ask", "p", "c", Answer, max_tokens=1000)
    assert res.output.title == "done"
    assert [c["max_tokens"] for c in sdk.calls] == [1000, 2000]

    llm2, sdk2 = make(_resp("{", stop="max_tokens"), _resp("{", stop="max_tokens"))
    with pytest.raises(LLMTruncated):
        await llm2.parse("ask", "p", "c", Answer)
    assert len(sdk2.calls) == 2


async def test_validation_failure_retries_with_error_then_raises():
    llm, sdk = make(_resp('{"title": "x"}'), _ok("fixed"))
    res = await llm.parse("ask", "p", "c", Answer)
    assert res.output.title == "fixed"
    retry_blocks = sdk.calls[1]["messages"][0]["content"]
    assert retry_blocks[0] == {"type": "text", "text": "c"}
    assert "score" in retry_blocks[-1]["text"]  # the validation error is appended
    assert sdk.calls[1]["messages"][-1]["role"] == "user"

    llm2, sdk2 = make(_resp("not json"), _resp("still not json"))
    with pytest.raises(SchemaValidationError):
        await llm2.parse("ask", "p", "c", Answer)
    assert len(sdk2.calls) == 2


async def test_batch_parse_in_order_and_cached():
    llm, sdk = make(_ok("a", 1), _ok("b", 2))
    reqs = [ParseRequest(prompt="p", content="one"), ParseRequest(prompt="p", content="two")]
    out = await llm.batch_parse("ask", reqs, Answer)
    assert sorted(r.output.title for r in out) == ["a", "b"]
    assert len(sdk.calls) == 2
    again = await llm.batch_parse("ask", reqs, Answer)
    assert all(r.cached for r in again) and len(sdk.calls) == 2


async def test_agent_not_implemented():
    llm, _ = make()
    with pytest.raises(NotImplementedError):
        await llm.agent("ask", "p")


def test_cache_key_stable_and_hashes_large_blocks():
    big = "A" * 100_000
    block = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": big}}
    kw = dict(route="ask", model="m", prompt_version="v", prompt="p", output=Answer)
    k1 = cache_key(content=[block], **kw)
    k2 = cache_key(content=[dict(reversed(list(block.items())))], **kw)
    assert k1 == k2 and len(k1) == 64
    other = {**block, "source": {**block["source"], "data": "B" * 100_000}}
    assert cache_key(content=[other], **kw) != k1


async def test_file_cache_store_roundtrip_and_atomic(tmp_path):
    store = FileCacheStore(tmp_path)
    assert await store.get("llm", "k") is None
    await store.put("llm", "k", {"a": [1, 2]})
    assert await store.get("llm", "k") == {"a": [1, 2]}
    await store.put_blob("tts", "../evil/key", b"\x00\x01")
    assert await store.get_blob("tts", "../evil/key") == b"\x00\x01"
    assert not list(tmp_path.rglob(".tmp-*"))  # no temp files left behind
    assert all(tmp_path in p.parents for p in tmp_path.rglob("*.bin"))  # stayed inside root

    await store.put_artifact("graph", "g1", Answer(title="x", score=2))
    assert await store.get_artifact("graph", "g1", Answer) == Answer(title="x", score=2)
    assert await store.get_artifact("graph", "missing", Answer) is None
    (tmp_path / "llm" / "bad.json").write_text("{not json", encoding="utf-8")
    assert await store.get("llm", "bad") is None
