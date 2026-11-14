"""Runner + validation harness: bad outputs, timeouts, contract checks, matrix."""

from __future__ import annotations

import time

import pytest

from app.tools.sandbox import (
    SimContractError,
    param_matrix,
    read_params,
    run_simulation,
    validate_code,
)
from app.tools.sandbox.harness import _execute

PARAM_A = '"a": {"min": 0.0, "max": 2.0, "default": 1.0, "step": 0.1, "unit": "", "label": "a"}'


def make(body: str, params: str = PARAM_A, imports: str = "import numpy as np\nimport math") -> str:
    indented = "\n".join("    " + line for line in body.strip().splitlines())
    return f"{imports}\nPARAMS = {{{params}}}\ndef simulate(a):\n{indented}\n"


def result(x: str = "[0.0, 1.0, 2.0]", y: str = "[0.0, a, 2 * a]") -> str:
    return (
        f'return {{"title": "t", "x_label": "x", "y_label": "y", '
        f'"series": [{{"name": "s", "x": {x}, "y": {y}}}]}}'
    )


GOOD = make(result())


# ----- run_simulation ------------------------------------------------------------------


async def test_good_run_returns_validated_output():
    out = await run_simulation(GOOD, {"a": 1.5})
    assert out.ok and out.output is not None
    assert out.output.series[0].y == [0.0, 1.5, 3.0]
    assert out.ms is not None


async def test_numpy_arrays_are_serialised():
    code = make(
        "x = np.linspace(0, 1, 4)\n"
        'return {"title": "t", "x_label": "x", "y_label": "y", '
        '"series": [{"name": "s", "x": x, "y": x * a}]}'
    )
    out = await run_simulation(code, {"a": 2.0})
    assert out.ok, out.issue
    assert out.output.series[0].y[-1] == pytest.approx(2.0)


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        (make(result(y='[0.0, float("nan"), 1.0]')), "E_OUTPUT"),
        (make(result(y='[0.0, float("inf"), 1.0]')), "E_OUTPUT"),
        (make(result(x="list(range(5001))", y="list(range(5001))")), "E_OUTPUT"),
        (make(result(x="[0.0, 1.0, 2.0]", y="[0.0, 1.0]")), "E_OUTPUT"),
        (make("return [1, 2, 3]"), "E_OUTPUT"),
        (make('return {"title": "t"}'), "E_OUTPUT"),
        (make("return {'title': 't', 'x_label': 'x', 'y_label': 'y', 'series': []}"), "E_OUTPUT"),
        (make("return 1 / (a - a)"), "E_RUNTIME"),
        (make("return undefined_name"), "E_RUNTIME"),
        ("import numpy as np\nPARAMS = {}\nprint(1)\ndef simulate(): return {}\n", "E_STATIC"),
        ("import numpy as np\nPARAMS = {}\nX = 1 / 0\ndef simulate(): return {}\n", "E_RUNTIME"),
    ],
)
async def test_bad_outputs_and_runtime_errors(code, expected):
    out = await run_simulation(code, {"a": 1.0})
    assert not out.ok
    assert out.issue.code == expected, out.issue


async def test_too_many_series():
    series = ", ".join(f'{{"name": "s{i}", "x": [0.0], "y": [0.0]}}' for i in range(5))
    code = make(f'return {{"title": "t", "x_label": "x", "y_label": "y", "series": [{series}]}}')
    out = await run_simulation(code, {"a": 1.0})
    assert out.issue.code == "E_OUTPUT"
    assert "series" in out.issue.message


async def test_infinite_loop_is_killed():
    code = make("while True:\n    pass")
    t0 = time.perf_counter()
    out = await run_simulation(code, {"a": 1.0}, timeout_s=1.5)
    assert out.issue.code == "E_TIMEOUT"
    assert time.perf_counter() - t0 < 8


async def test_output_size_cap():
    code = make('return {"title": "t" * 5000000}')
    out = await run_simulation(code, {"a": 1.0})
    assert not out.ok and out.issue.code in {"E_RUNTIME", "E_OUTPUT"}


def test_runner_blocks_imports_and_builtins_even_without_static_check():
    # bypass check_static to prove the runner-level restrictions hold on their own
    bad_import = _execute("import os\ndef simulate(): return {}\n", [{}], 10)[0]
    assert bad_import.issue.code == "E_RUNTIME" and "not allowed" in bad_import.issue.message
    no_open = _execute("def simulate():\n    return open('x')\n", [{}], 10)[0]
    assert no_open.issue.code == "E_RUNTIME" and "open" in no_open.issue.message
    no_dunder = _execute("def simulate():\n    return __import__('os')\n", [{}], 10)[0]
    assert not no_dunder.ok


def test_runner_runs_several_param_sets_in_one_process():
    outs = _execute(GOOD, [{"a": 0.0}, {"a": 1.0}, {"a": 2.0}], 10)
    assert [o.output.series[0].y[-1] for o in outs] == [0.0, 2.0, 4.0]


# ----- read_params / matrix ------------------------------------------------------------


def test_read_params_validates_specs():
    params = read_params(GOOD)
    assert list(params) == ["a"] and params["a"].default == 1.0


@pytest.mark.parametrize(
    "code",
    [
        "def simulate(): pass\n",  # no PARAMS
        "PARAMS = {}\n",  # empty
        "import math\nPARAMS = {'a': math.pi}\n",  # not a literal
        'PARAMS = {"a": {"min": 1, "max": 0, "default": 0, "step": 1, "unit": "", "label": "a"}}',
        'PARAMS = {"a": {"min": 0, "max": 1, "default": 5, "step": 1, "unit": "", "label": "a"}}',
        'PARAMS = {"a": {"min": 0, "max": 1}}',
        "PARAMS = {" + ",".join(f'"p{i}": {{}}' for i in range(6)) + "}",
    ],
)
def test_read_params_rejects_bad_params(code):
    with pytest.raises(SimContractError) as exc:
        read_params(code)
    assert all(i.code == "E_CONTRACT" for i in exc.value.issues)


def test_param_matrix_shape_and_cap():
    params = read_params(make("return 1", params=PARAM_A + ", " + PARAM_A.replace('"a"', '"b"')))
    matrix = param_matrix(params)
    assert matrix[0] == {"a": 1.0, "b": 1.0}  # defaults first
    assert {"a": 0.0, "b": 0.0} in matrix and {"a": 2.0, "b": 2.0} in matrix
    assert {"a": 0.0, "b": 1.0} in matrix and {"a": 1.0, "b": 2.0} in matrix
    assert len(matrix) == 7
    assert len(param_matrix(params, cap=4)) == 4
    many = {f"p{i}": {"min": 0, "max": 1, "default": 0.5} for i in range(5)}
    assert len(param_matrix(many)) == 9


# ----- validate_code -------------------------------------------------------------------


async def test_validate_passes_good_code():
    report = await validate_code(GOOD)
    assert report.status == "passed", report.errors
    assert len(report.runs) == 3 and all(r.ok for r in report.runs)
    assert report.default_output is not None and report.params is not None
    assert "params" not in report.model_dump()


async def test_validate_reports_which_run_failed():
    code = make("if a > 1.5:\n    return 1 / 0\n" + result())
    report = await validate_code(code)
    assert report.status == "failed"
    assert report.errors[0].code == "E_RUNTIME" and report.errors[0].run == "all_max"


async def test_validate_static_and_contract_failures():
    assert (await validate_code("import os\n")).errors[0].code == "E_STATIC"
    assert (await validate_code("import math\n")).errors[0].code == "E_CONTRACT"
    wrong_args = f"PARAMS = {{{PARAM_A}}}\ndef simulate(b):\n    return {{}}\n"
    assert (await validate_code(wrong_args)).errors[0].code == "E_CONTRACT"
    no_sim = f"PARAMS = {{{PARAM_A}}}\n"
    assert (await validate_code(no_sim)).errors[0].code == "E_CONTRACT"


async def test_validate_warns_about_noop_slider():
    code = make(result(y="[0.0, 1.0, 2.0]"))
    report = await validate_code(code)
    assert report.status == "passed"
    assert [w.code for w in report.warnings] == ["W_NOOP_PARAM"]


async def test_validate_timeout():
    report = await validate_code(make("while True:\n    pass"), timeout_s=1.5)
    assert report.status == "failed" and report.errors[0].code == "E_TIMEOUT"
