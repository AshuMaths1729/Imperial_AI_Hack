"""Static checks, subprocess runner and validation matrix for generated simulation code.

Contract (guide §3.3): the code defines a literal `PARAMS = {name: {min, max, default, step,
unit, label}}` (1-5 params) and `simulate(**params) -> {title, x_label, y_label, series}`.

Layers of defence for untrusted (LLM-written) code, in order:
  1. `check_static`: AST allow-list (imports, banned builtins, no dunder access, ...).
  2. `run_simulation`: a fresh `python -I` subprocess with restricted builtins and an import
     allow-list, JSON in/out, hard timeout (process kill), output size cap.
  3. Output validation with the shared `SimOutput` schema.

This is a hackathon-grade sandbox (no OS-level isolation); swap the runner for Docker/Pyodide
without touching the callers.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from functools import partial
from typing import Any, Literal

import anyio.to_thread
from pydantic import BaseModel, Field, ValidationError

from app.schemas.sim import ParamSpec, SimOutput

MAX_CODE_CHARS = 60_000
MAX_OUTPUT_BYTES = 4_000_000
MAX_SERIES = 4
MAX_PARAMS = 5
SLOW_MS = 300.0
DEFAULT_TIMEOUT_S = 10.0

E_STATIC = "E_STATIC"
E_CONTRACT = "E_CONTRACT"
E_RUNTIME = "E_RUNTIME"
E_OUTPUT = "E_OUTPUT"
E_TIMEOUT = "E_TIMEOUT"


class Issue(BaseModel):
    code: str
    message: str
    line: int | None = None
    run: str | None = None  # which matrix run it came from ("default", "gamma:max", ...)


class RunRecord(BaseModel):
    label: str
    params: dict[str, float]
    ms: float | None = None
    ok: bool = True


class ValidationReport(BaseModel):
    status: Literal["passed", "failed"]
    errors: list[Issue] = Field(default_factory=list)
    warnings: list[Issue] = Field(default_factory=list)
    runs: list[RunRecord] = Field(default_factory=list)
    # convenience for callers; not part of the serialized report
    params: dict[str, ParamSpec] | None = Field(default=None, exclude=True)
    default_output: SimOutput | None = Field(default=None, exclude=True)


class SimContractError(Exception):
    def __init__(self, issues: list[Issue]) -> None:
        super().__init__("; ".join(i.message for i in issues))
        self.issues = issues


@dataclass
class RunOutcome:
    ok: bool
    output: SimOutput | None = None
    issue: Issue | None = None
    ms: float | None = None  # time spent inside simulate(), measured in the subprocess


# --------------------------------------------------------------------------------------
# 1. static checks
# --------------------------------------------------------------------------------------

_NUMPY_SUBMODULES = {"linalg", "fft", "random", "polynomial"}
_SCIPY_SUBMODULES = {"integrate", "optimize", "special", "linalg", "interpolate", "signal", "fft"}

_BANNED_NAMES = {
    "exec", "eval", "compile", "open", "__import__", "getattr", "setattr", "delattr",
    "globals", "locals", "vars", "input", "breakpoint", "exit", "quit", "help", "memoryview",
}  # fmt: skip
# attribute names that are never needed by a simulation and open file / frame / module access
_BANNED_ATTRS = {
    "load", "loads", "fromfile", "memmap", "ctypeslib", "loadtxt", "genfromtxt", "fromregex",
    "save", "savez", "savez_compressed", "savetxt", "tofile", "lib", "core", "f2py", "testing",
    "distutils", "system", "popen", "os", "sys", "subprocess", "builtins", "modules",
    "gi_frame", "gi_code", "f_globals", "f_locals", "f_back", "f_builtins", "tb_frame",
    "cr_frame", "ag_frame", "func_globals", "mro",
}  # fmt: skip
_BANNED_NODES: tuple[type[ast.AST], ...] = (
    ast.ClassDef,
    ast.AsyncFunctionDef,
    ast.Await,
    ast.AsyncFor,
    ast.AsyncWith,
    ast.Global,
    ast.Nonlocal,
)
_TOP_LEVEL_OK: tuple[type[ast.AST], ...] = (
    ast.Import,
    ast.ImportFrom,
    ast.FunctionDef,
    ast.Assign,
    ast.AnnAssign,
)


def _module_allowed(mod: str) -> bool:
    parts = mod.split(".")
    root = parts[0]
    if root == "math":
        return len(parts) == 1
    if root == "numpy":
        return len(parts) == 1 or (parts[1] in _NUMPY_SUBMODULES)
    if root == "scipy":
        return len(parts) >= 2 and parts[1] in _SCIPY_SUBMODULES
    return False


class _Checker(ast.NodeVisitor):
    def __init__(self) -> None:
        self.issues: list[Issue] = []
        self.numpy_names: set[str] = set()
        self.scipy_names: set[str] = set()

    def add(self, node: ast.AST, msg: str) -> None:
        self.issues.append(Issue(code=E_STATIC, message=msg, line=getattr(node, "lineno", None)))

    def generic_visit(self, node: ast.AST) -> None:
        if isinstance(node, _BANNED_NODES):
            self.add(node, f"{type(node).__name__} is not allowed (use plain functions)")
        super().generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if not _module_allowed(alias.name):
                self.add(node, f"import of '{alias.name}' is not allowed")
                continue
            root = alias.name.split(".")[0]
            bound = alias.asname or root
            if root == "numpy" and (alias.asname or "." not in alias.name):
                self.numpy_names.add(bound)
            if root == "scipy" and not alias.asname:
                self.scipy_names.add("scipy")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        mod = node.module or ""
        if node.level:
            self.add(node, "relative imports are not allowed")
            return
        names = [a.name for a in node.names]
        if "*" in names:
            self.add(node, "star imports are not allowed")
            return
        if mod == "scipy":
            for n in names:
                if n not in _SCIPY_SUBMODULES:
                    self.add(node, f"import of 'scipy.{n}' is not allowed")
            return
        if mod == "numpy":
            for n in names:
                if n in _BANNED_ATTRS or n.startswith("__"):
                    self.add(node, f"import of 'numpy.{n}' is not allowed")
                elif n in _NUMPY_SUBMODULES:
                    pass
            return
        if not _module_allowed(mod):
            self.add(node, f"import from '{mod}' is not allowed")
            return
        for n in names:
            if n in _BANNED_ATTRS or n.startswith("__"):
                self.add(node, f"import of '{mod}.{n}' is not allowed")

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in _BANNED_NAMES:
            self.add(node, f"use of '{node.id}' is not allowed")
        elif node.id.startswith("__"):
            self.add(node, f"dunder name '{node.id}' is not allowed")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("__"):
            self.add(node, f"dunder attribute '{node.attr}' is not allowed")
        elif node.attr in _BANNED_ATTRS:
            self.add(node, f"attribute '.{node.attr}' is not allowed")
        elif (
            isinstance(node.value, ast.Name)
            and node.value.id in self.scipy_names
            and node.attr not in _SCIPY_SUBMODULES
        ):
            self.add(node, f"'scipy.{node.attr}' is not allowed")
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        if isinstance(node.value, str) and "__" in node.value:
            self.add(node, "string literals containing '__' are not allowed")


def check_static(code: str) -> list[Issue]:
    """AST allow-list check; an empty list means the code may be executed."""
    if len(code) > MAX_CODE_CHARS:
        return [Issue(code=E_STATIC, message=f"code is longer than {MAX_CODE_CHARS} characters")]
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return [Issue(code=E_STATIC, message=f"SyntaxError: {exc.msg}", line=exc.lineno)]
    checker = _Checker()
    for stmt in tree.body:
        is_docstring = (
            isinstance(stmt, ast.Expr)
            and isinstance(stmt.value, ast.Constant)
            and isinstance(stmt.value.value, str)
        )
        if not (is_docstring or isinstance(stmt, _TOP_LEVEL_OK)):
            checker.add(
                stmt, f"top-level {type(stmt).__name__} not allowed: no top-level computation"
            )
    checker.visit(tree)
    seen: set[tuple[str, int | None]] = set()
    unique: list[Issue] = []
    for issue in checker.issues:
        key = (issue.message, issue.line)
        if key not in seen:
            seen.add(key)
            unique.append(issue)
    return unique


# --------------------------------------------------------------------------------------
# 2. contract: PARAMS and simulate signature
# --------------------------------------------------------------------------------------


def read_params(code: str) -> dict[str, ParamSpec]:
    """`ast.literal_eval` the top-level `PARAMS` assignment and validate it (no code runs)."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise SimContractError(
            [Issue(code=E_CONTRACT, message=f"SyntaxError: {exc.msg}", line=exc.lineno)]
        ) from exc

    node: ast.expr | None = None
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "PARAMS" for t in stmt.targets
        ):
            node = stmt.value
        elif (
            isinstance(stmt, ast.AnnAssign)
            and isinstance(stmt.target, ast.Name)
            and stmt.target.id == "PARAMS"
            and stmt.value is not None
        ):
            node = stmt.value
    if node is None:
        raise SimContractError([Issue(code=E_CONTRACT, message="no top-level PARAMS assignment")])
    try:
        raw = ast.literal_eval(node)
    except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError) as exc:
        raise SimContractError(
            [Issue(code=E_CONTRACT, message=f"PARAMS must be a literal dict: {exc}")]
        ) from exc
    if not isinstance(raw, dict) or not 1 <= len(raw) <= MAX_PARAMS:
        raise SimContractError(
            [Issue(code=E_CONTRACT, message=f"PARAMS must be a dict with 1-{MAX_PARAMS} entries")]
        )
    out: dict[str, ParamSpec] = {}
    issues: list[Issue] = []
    for name, spec in raw.items():
        if not isinstance(name, str) or not name.isidentifier() or name.startswith("_"):
            issues.append(Issue(code=E_CONTRACT, message=f"bad parameter name {name!r}"))
            continue
        try:
            out[name] = ParamSpec.model_validate(spec)
        except ValidationError as exc:
            detail = "; ".join(
                f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:3]
            )
            issues.append(Issue(code=E_CONTRACT, message=f"PARAMS[{name!r}] invalid: {detail}"))
    if issues:
        raise SimContractError(issues)
    return out


def _check_signature(code: str, params: Mapping[str, ParamSpec]) -> list[Issue]:
    tree = ast.parse(code)
    fn = next(
        (s for s in tree.body if isinstance(s, ast.FunctionDef) and s.name == "simulate"), None
    )
    if fn is None:
        return [Issue(code=E_CONTRACT, message="no top-level `def simulate(**params)`")]
    if fn.args.kwarg is not None:
        return []
    accepted = {a.arg for a in [*fn.args.posonlyargs, *fn.args.args, *fn.args.kwonlyargs]}
    missing = [p for p in params if p not in accepted]
    if missing:
        return [
            Issue(
                code=E_CONTRACT,
                message=f"simulate() does not accept PARAMS entries {missing} (add them as "
                "arguments or use **params)",
                line=fn.lineno,
            )
        ]
    return []


# --------------------------------------------------------------------------------------
# 3. subprocess runner
# --------------------------------------------------------------------------------------

_RUNNER = r"""
import sys, json, io, time, traceback, builtins as _b

_real_out = sys.stdout
_payload = json.loads(sys.stdin.read())
_CAP = _payload["cap"]
_ROOTS = ("numpy", "scipy", "math")
_real_import = _b.__import__


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or name.split(".")[0] not in _ROOTS:
        raise ImportError("import of %r is not allowed" % (name,))
    return _real_import(name, globals, locals, fromlist, level)


_SAFE = (
    "abs all any bool dict divmod enumerate filter float int isinstance issubclass iter len "
    "list map max min next pow range repr reversed round set slice sorted str sum tuple zip "
    "complex callable hash chr ord frozenset ArithmeticError AssertionError AttributeError "
    "Exception FloatingPointError IndexError KeyError LookupError OverflowError RuntimeError "
    "StopIteration TypeError ValueError ZeroDivisionError NotImplemented Ellipsis"
).split()
_builtins = {n: getattr(_b, n) for n in _SAFE if hasattr(_b, n)}
_builtins["__import__"] = _safe_import
_builtins["print"] = lambda *a, **k: None


def _emit(text):
    _real_out.write(text + "\n")
    _real_out.flush()


def _conv(o):
    if hasattr(o, "tolist"):
        return o.tolist()
    if hasattr(o, "item"):
        return o.item()
    raise TypeError("not JSON serialisable: " + type(o).__name__)


def _tb():
    lines = traceback.format_exc().strip().splitlines()
    return "\n".join(lines[-6:])[-900:]


sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
try:
    _g = {"__builtins__": _builtins, "__name__": "sim_module"}
    exec(compile(_payload["code"], "<sim>", "exec"), _g)
    _fn = _g.get("simulate")
    if not callable(_fn):
        raise RuntimeError("simulate() is not defined")
except BaseException:
    _emit(json.dumps({"setup_error": _tb()}))
    sys.exit(0)

for _params in _payload["runs"]:
    _t0 = time.perf_counter()
    try:
        _res = _fn(**_params)
        _ms = (time.perf_counter() - _t0) * 1000.0
        _text = json.dumps(_res, default=_conv)
        if len(_text) > _CAP:
            raise ValueError("output larger than %d bytes" % _CAP)
        _emit('{"ok": true, "ms": %.3f, "result": %s}' % (_ms, _text))
    except BaseException:
        _emit(json.dumps({"ok": False, "ms": (time.perf_counter() - _t0) * 1000.0, "error": _tb()}))
"""

_spawn_slots = threading.BoundedSemaphore(4)


def _short(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:3])


def _outcome_from_msg(msg: dict[str, Any]) -> RunOutcome:
    ms = msg.get("ms")
    if not msg.get("ok"):
        return RunOutcome(
            ok=False,
            ms=ms,
            issue=Issue(code=E_RUNTIME, message=str(msg.get("error", "runtime error"))),
        )
    try:
        out = SimOutput.model_validate(msg["result"])
    except ValidationError as exc:
        return RunOutcome(
            ok=False, ms=ms, issue=Issue(code=E_OUTPUT, message=f"invalid output: {_short(exc)}")
        )
    if len(out.series) > MAX_SERIES:
        return RunOutcome(
            ok=False,
            ms=ms,
            issue=Issue(code=E_OUTPUT, message=f"{len(out.series)} series; at most {MAX_SERIES}"),
        )
    return RunOutcome(ok=True, output=out, ms=ms)


def _execute(code: str, runs: list[dict[str, float]], timeout_s: float) -> list[RunOutcome]:
    """Run `simulate(**p)` for each p in `runs` in ONE fresh subprocess. Blocking."""
    payload = json.dumps({"code": code, "runs": runs, "cap": MAX_OUTPUT_BYTES}).encode("ascii")
    timed_out = False
    with _spawn_slots:
        try:
            proc = subprocess.run(
                [sys.executable, "-I", "-c", _RUNNER],
                input=payload,
                capture_output=True,
                timeout=timeout_s,
            )
            stdout, stderr, rc = proc.stdout, proc.stderr, proc.returncode
        except subprocess.TimeoutExpired as exc:
            stdout, stderr, rc, timed_out = exc.stdout or b"", exc.stderr or b"", None, True

    msgs: list[dict[str, Any]] = []
    for line in stdout.decode("utf-8", "replace").splitlines():
        try:
            msgs.append(json.loads(line))
        except ValueError:
            break  # truncated line from a killed process
    if msgs and "setup_error" in msgs[0]:
        return [
            RunOutcome(
                ok=False,
                issue=Issue(
                    code=E_RUNTIME, message="module failed to load: " + msgs[0]["setup_error"]
                ),
            )
        ]
    outcomes = [_outcome_from_msg(m) for m in msgs[: len(runs)]]
    if timed_out:
        outcomes.append(
            RunOutcome(
                ok=False,
                issue=Issue(code=E_TIMEOUT, message=f"run exceeded {timeout_s:g}s and was killed"),
            )
        )
    elif len(outcomes) < len(runs):
        tail = stderr.decode("utf-8", "replace").strip()[-400:]
        outcomes.append(
            RunOutcome(
                ok=False,
                issue=Issue(
                    code=E_RUNTIME,
                    message=f"runner exited early (code {rc})" + (f": {tail}" if tail else ""),
                ),
            )
        )
    return outcomes


async def run_simulation(
    code: str, params: Mapping[str, float], timeout_s: float = DEFAULT_TIMEOUT_S
) -> RunOutcome:
    """Run one simulation in a fresh subprocess (thread-wrapped, kill on timeout)."""
    static = check_static(code)
    if static:
        return RunOutcome(ok=False, issue=static[0])
    outcomes = await anyio.to_thread.run_sync(
        partial(_execute, code, [dict(params)], timeout_s), abandon_on_cancel=False
    )
    return outcomes[0]


# --------------------------------------------------------------------------------------
# 4. validation matrix
# --------------------------------------------------------------------------------------


def _bounds(spec: Any) -> tuple[float, float, float]:
    if isinstance(spec, Mapping):
        return float(spec["min"]), float(spec["max"]), float(spec["default"])
    return float(spec.min), float(spec.max), float(spec.default)


def _matrix_entries(params: Mapping[str, Any], cap: int = 9) -> list[tuple[str, dict[str, float]]]:
    b = {k: _bounds(v) for k, v in params.items()}
    defaults = {k: v[2] for k, v in b.items()}
    entries: list[tuple[str, dict[str, float]]] = [
        ("default", dict(defaults)),
        ("all_min", {k: v[0] for k, v in b.items()}),
        ("all_max", {k: v[1] for k, v in b.items()}),
    ]
    for k, (lo, hi, _d) in b.items():
        entries.append((f"{k}:min", {**defaults, k: lo}))
        entries.append((f"{k}:max", {**defaults, k: hi}))
    seen: list[dict[str, float]] = []
    out: list[tuple[str, dict[str, float]]] = []
    for label, p in entries:
        if label != "default" and p in seen:
            continue
        seen.append(p)
        out.append((label, p))
    return out[:cap]


def param_matrix(params: Mapping[str, Any], cap: int = 9) -> list[dict[str, float]]:
    """Defaults + all-min + all-max + one-at-a-time extremes, deduplicated, at most `cap`."""
    return [p for _label, p in _matrix_entries(params, cap)]


def _same_output(a: SimOutput, b: SimOutput) -> bool:
    return len(a.series) == len(b.series) and all(
        sa.y == sb.y for sa, sb in zip(a.series, b.series, strict=True)
    )


def _fail(errors: list[Issue]) -> ValidationReport:
    return ValidationReport(status="failed", errors=errors)


async def validate_code(code: str, timeout_s: float = 15.0) -> ValidationReport:
    """Static check, contract check, then run the parameter matrix in one subprocess."""
    static = check_static(code)
    if static:
        return _fail(static)
    try:
        params = read_params(code)
    except SimContractError as exc:
        return _fail(exc.issues)
    sig = _check_signature(code, params)
    if sig:
        return _fail(sig)

    entries = _matrix_entries(params)
    outcomes = await anyio.to_thread.run_sync(
        partial(_execute, code, [p for _l, p in entries], timeout_s), abandon_on_cancel=False
    )

    errors: list[Issue] = []
    warnings: list[Issue] = []
    runs: list[RunRecord] = []
    by_label: dict[str, SimOutput] = {}
    by_params: dict[tuple, SimOutput] = {}
    for i, outcome in enumerate(outcomes):
        label, p = entries[i] if i < len(entries) else ("setup", {})
        runs.append(RunRecord(label=label, params=p, ms=outcome.ms, ok=outcome.ok))
        if not outcome.ok and outcome.issue is not None:
            errors.append(outcome.issue.model_copy(update={"run": label}))
        elif outcome.output is not None:
            by_label[label] = outcome.output
            by_params[tuple(sorted(p.items()))] = outcome.output
            if outcome.ms is not None and outcome.ms > SLOW_MS:
                warnings.append(
                    Issue(
                        code="W_SLOW",
                        message=f"run took {outcome.ms:.0f} ms (> {SLOW_MS:.0f} ms)",
                        run=label,
                    )
                )
    if errors:
        report = _fail(errors)
        report.runs, report.warnings = runs, warnings
        return report

    base = by_label.get("default")
    if base is not None:
        defaults = {k: _bounds(v)[2] for k, v in params.items()}
        for name, spec in params.items():
            lo_p, hi_p = {**defaults, name: _bounds(spec)[0]}, {**defaults, name: _bounds(spec)[1]}
            lo, hi = (
                by_params.get(tuple(sorted(lo_p.items()))),
                by_params.get(tuple(sorted(hi_p.items()))),
            )
            if lo is None or hi is None:
                continue
            if _same_output(lo, base) and _same_output(hi, base):
                msg = f"slider '{name}' does not change the output"
                warnings.append(Issue(code="W_NOOP_PARAM", message=msg))
    return ValidationReport(
        status="passed",
        warnings=warnings,
        runs=runs,
        params=params,
        default_output=base,
    )
