"""Fakes for the LLM layer: `FakeLLM` and `FakeExtractor` (fixture-backed).

`FakeLLM` returns queued or fixture outputs, validated against the `output` type the caller
asked for, so a test fails the same way a real model reply that breaks the schema would.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from app.core.errors import SchemaValidationError, UpstreamError
from app.core.fixtures import load_fixture
from app.llm.client import Content, LLMResult, ParseRequest
from app.llm.extractor import Claim, Paper, SourceDoc
from app.schemas.graph import Edge, Graph


@dataclass
class RecordedLLMCall:
    method: str  # "parse" | "agent" | "batch_parse"
    route: str
    prompt: str
    content: Any
    output: type | None


class FakeLLM:
    """Outputs come from, in order: `queue(route, ...)`, `outputs[route]`, then
    `<fixture_dir>/<route>.json`. A queued value can be a model instance, a dict, a JSON
    string, or (for `agent` without `output`) plain text."""

    def __init__(
        self,
        outputs: Mapping[str, Any] | None = None,
        fixture_dir: Path | None = None,
    ) -> None:
        self.outputs: dict[str, Any] = dict(outputs or {})
        self.fixture_dir = fixture_dir
        self._queues: dict[str, list[Any]] = {}
        self.calls: list[RecordedLLMCall] = []

    def queue(self, route: str, *values: Any) -> FakeLLM:
        self._queues.setdefault(route, []).extend(values)
        return self

    def _next(self, route: str) -> Any:
        if self._queues.get(route):
            return self._queues[route].pop(0)
        if route in self.outputs:
            return self.outputs[route]
        if self.fixture_dir is not None:
            path = self.fixture_dir / f"{route}.json"
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        raise UpstreamError(
            f"FakeLLM has no output queued for route {route!r}", details={"route": route}
        )

    @staticmethod
    def _coerce(value: Any, output: type | None) -> Any:
        if output is None or not (isinstance(output, type) and issubclass(output, BaseModel)):
            return value
        if isinstance(value, output):
            return value
        try:
            if isinstance(value, str | bytes):
                return output.model_validate_json(value)
            return output.model_validate(value)
        except ValidationError as exc:
            raise SchemaValidationError(
                f"FakeLLM output does not match {output.__name__}",
                details={"errors": json.loads(exc.json())},
            ) from exc

    async def parse(
        self,
        route: str,
        prompt: str,
        content: Content,
        output: type,
        *,
        prompt_version: str = "",
        max_tokens: int | None = None,
    ) -> LLMResult[Any]:
        self.calls.append(RecordedLLMCall("parse", route, prompt, content, output))
        return LLMResult(output=self._coerce(self._next(route), output), model="fake")

    async def agent(
        self,
        route: str,
        prompt: str,
        *,
        content: Content = "",
        tools: Sequence[str] = (),
        mcp: Sequence[str] = (),
        output: type | None = None,
        prompt_version: str = "",
    ) -> LLMResult[Any]:
        self.calls.append(RecordedLLMCall("agent", route, prompt, content, output))
        return LLMResult(output=self._coerce(self._next(route), output), model="fake")

    async def batch_parse(
        self, route: str, requests: Sequence[ParseRequest], output: type
    ) -> list[LLMResult[Any]]:
        results: list[LLMResult[Any]] = []
        for req in requests:
            self.calls.append(
                RecordedLLMCall("batch_parse", route, req.prompt, req.content, output)
            )
            results.append(LLMResult(output=self._coerce(self._next(route), output), model="fake"))
        return results


class FakeExtractor:
    """Placeholder `frontier` extractor: answers from the shared fixtures."""

    async def lecture_graph(self, doc: SourceDoc) -> Graph:
        return load_fixture("lecture_graph", Graph)

    async def paper_claims(self, paper: Paper) -> list[Claim]:
        return []

    async def compare_claims(self, cluster: list[Claim]) -> list[Edge]:
        graph = load_fixture("hypothesis_graph", Graph)
        return [e for e in graph.edges if e.type in ("supports", "contradicts")]
