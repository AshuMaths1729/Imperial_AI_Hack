"""Static (AST) checks on generated simulation code: escape attempts must be rejected."""

from __future__ import annotations

import pytest

from app.tools.sandbox import check_static
from tests.heavy_ball import HEAVY_BALL_CODE

HEAD = "import numpy as np\nimport math\n"


def wrap(body: str, head: str = HEAD) -> str:
    return head + "def simulate(a):\n    " + body.replace("\n", "\n    ") + "\n"


REJECTED = {
    "import_os": "import os\n",
    "import_sys": "import sys\n",
    "import_subprocess": "import subprocess\n",
    "from_os": "from os import path\n",
    "import_socket": "import socket\n",
    "import_pyodide": "import pyodide\n",
    "import_js": "import js\n",
    "import_scipy_io": "import scipy.io\n",
    "from_scipy_io": "from scipy.io import loadmat\n",
    "from_scipy_import_io": "from scipy import io\n",
    "bare_scipy": "import scipy\n",
    "relative_import": "from . import x\n",
    "star_import": "from numpy import *\n",
    "numpy_ctypeslib": "import numpy.ctypeslib\n",
    "from_numpy_load": "from numpy import load\n",
    "dunder_import": wrap("return __import__('os')"),
    "eval": wrap("return eval('1')"),
    "exec": wrap("exec('x = 1')"),
    "compile": wrap("return compile('1', 'f', 'eval')"),
    "open": wrap("return open('secret.txt').read()"),
    "getattr": wrap("return getattr(a, 'real')"),
    "setattr": wrap("setattr(a, 'x', 1)"),
    "globals": wrap("return globals()"),
    "locals": wrap("return locals()"),
    "input": wrap("return input()"),
    "dunder_class_chain": wrap("return ().__class__.__bases__[0].__subclasses__()"),
    "dunder_globals": wrap("return simulate.__globals__"),
    "dunder_name": wrap("return __builtins__"),
    "format_dunder": wrap("return '{0.__class__}'.format(a)"),
    "np_load": wrap("return np.load('x.npy')"),
    "np_fromfile": wrap("return np.fromfile('x')"),
    "np_memmap": wrap("return np.memmap('x')"),
    "np_ctypeslib": wrap("return np.ctypeslib"),
    "np_lib": wrap("return np.lib"),
    "scipy_io_attr": "import scipy.integrate\n" + wrap("return scipy.io.loadmat('x')", head=""),
    "frame_walk": wrap("return (x for x in []).gi_frame.f_globals"),
    "class_def": HEAD + "class A:\n    pass\n",
    "top_level_while": HEAD + "while True:\n    pass\n",
    "top_level_call": HEAD + "print(1)\n",
    "syntax_error": "def simulate(:\n",
    "too_long": "x = 1\n" * 20_000,
}


@pytest.mark.parametrize("name", list(REJECTED))
def test_escape_attempts_are_rejected(name):
    issues = check_static(REJECTED[name])
    assert issues, f"{name} should be rejected"
    assert all(i.code == "E_STATIC" for i in issues)


ACCEPTED = {
    "numpy_math": HEAD + "PARAMS = {}\n" + wrap("return np.sin(math.pi * a)"),
    "solve_ivp": "import numpy as np\nfrom scipy.integrate import solve_ivp\n"
    + wrap("return solve_ivp(lambda t, y: -a * y, (0, 1), [1.0], t_eval=np.linspace(0, 1, 5))"),
    "scipy_from_import": "from scipy import integrate, optimize\n"
    + wrap("return integrate.quad(lambda x: x, 0, 1)"),
    "scipy_alias": "import scipy.integrate as si\n" + wrap("return si.trapezoid([1, 2], [0, 1])"),
    "scipy_attr_chain": "import scipy.integrate\n"
    + wrap("return scipy.integrate.trapezoid([1, 2], [0, 1])", head=""),
    "numpy_random": "import numpy as np\n" + wrap("return np.random.default_rng(0).random()"),
    "docstring_and_constants": '"""doc"""\nT = 10.0\n' + wrap("return T * a"),
    "seed_sim": HEAVY_BALL_CODE,
}


@pytest.mark.parametrize("name", list(ACCEPTED))
def test_legit_code_is_accepted(name):
    assert check_static(ACCEPTED[name]) == []


def test_issue_carries_line_number():
    issues = check_static("import numpy\nimport os\n")
    assert issues[0].line == 2
