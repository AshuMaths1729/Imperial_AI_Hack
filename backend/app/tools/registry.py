"""Registries: custom tools, route policies, MCP servers, extractors, sandbox runners.

Each `modules/<m>/__init__.py` may export `register(reg: Registry)` to add its own entries,
so adding a module touches no shared code. `create_app()` calls every module's `register`
once at startup. Callers pick implementations by name (from settings), never by `if/else`.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel

from app.llm.extractor import ExtractorRegistry

Trust = Literal["trusted", "untrusted"]
SideEffect = Literal["none", "paid", "write"]


@dataclass(frozen=True)
class ToolDef:
    """A custom tool (our own function) that agents or pipelines may call via the broker.

    trust:       "untrusted" if the tool's *output* is fetched web/paper content (data, never
                 instructions).
    side_effect: "none" (read-only), "paid" (costs money) or "write" (changes external state).
                 A route that allows untrusted-output tools may not also allow paid/write ones.
    """

    name: str
    description: str
    input_model: type[BaseModel]
    fn: Callable[..., Awaitable[Any]]
    trust: Trust = "trusted"
    side_effect: SideEffect = "none"


@dataclass(frozen=True)
class RoutePolicy:
    """What one route (e.g. "hypothesis.research") may do through the broker."""

    route: str
    allowed_tools: frozenset[str] = frozenset()
    max_calls: int = 20
    max_cost_usd: float = 1.0
    timeout_s: float = 60.0
    max_iterations: int = 8


@dataclass(frozen=True)
class McpServerConfig:
    """A remote MCP server reachable through the Claude MCP connector."""

    name: str
    url: str
    token_env: str  # env var (settings field) holding the API key
    allowed_tools: frozenset[str] = frozenset()
    flag: str | None = None  # settings flag that must be true, e.g. "fal_mcp_enabled"
    auth: Literal["bearer", "query"] = "bearer"


@dataclass
class Registry:
    tools: dict[str, ToolDef] = field(default_factory=dict)
    policies: dict[str, RoutePolicy] = field(default_factory=dict)
    mcp_servers: dict[str, McpServerConfig] = field(default_factory=dict)
    extractors: ExtractorRegistry = field(default_factory=ExtractorRegistry)
    # name -> factory/instance of a sandbox runner ("docker", "pyodide-node", ...); Track B
    sandbox_runners: dict[str, Any] = field(default_factory=dict)

    def add_tool(self, tool: ToolDef) -> None:
        _put(self.tools, tool.name, tool, "tool")

    def add_policy(self, policy: RoutePolicy) -> None:
        _put(self.policies, policy.route, policy, "route policy")

    def add_mcp_server(self, server: McpServerConfig) -> None:
        _put(self.mcp_servers, server.name, server, "MCP server")

    def add_sandbox_runner(self, name: str, runner: Any) -> None:
        _put(self.sandbox_runners, name, runner, "sandbox runner")


def _put(table: dict[str, Any], key: str, value: Any, what: str) -> None:
    if key in table:
        raise ValueError(f"{what} {key!r} is already registered")
    table[key] = value
