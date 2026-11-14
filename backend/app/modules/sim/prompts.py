"""Prompts for Paper2Sim code generation and repair (versioned: bump on any edit)."""

PROMPT_VERSION = "sim-v1"

CONTRACT = """\
The code must be ONE self-contained Python module with exactly this contract:

1. Imports: only `math`, `numpy`, and `scipy.integrate|optimize|special|linalg|interpolate|\
signal|fft`. Nothing else: no os/sys/io/subprocess/requests, no file or network access, no \
`open`, `eval`, `exec`, `getattr`, `__import__`, no dunder attributes, no classes.
2. A top-level LITERAL dict (no computation, no variables inside it):
   PARAMS = {"<name>": {"min": float, "max": float, "default": float, "step": float,
                        "unit": str, "label": str}, ...}
   with 1 to 5 parameters, min < max, min <= default <= max, step > 0.
3. `def simulate(**params)` (or explicit keyword args matching the PARAMS names) returning a \
plain dict:
   {"title": str, "x_label": str, "y_label": str,
    "series": [{"name": str, "x": [float, ...], "y": [float, ...]}, ...]}
   - 1 to 4 series; x and y are plain Python lists (call `.tolist()` on numpy arrays) of \
finite floats (no NaN/inf), same length, at most 5000 points per series.
   - deterministic (fixed seeds), no I/O, and each call finishes in well under 200 ms.
4. No top-level computation: only imports, PARAMS, constants and function definitions.
"""

CODEGEN_PROMPT = f"""\
You turn the key model, equation or algorithm of a scientific paper into a small interactive \
simulation that a student can explore with sliders.

{CONTRACT}
Style rules:
- Name the parameters after the paper's own symbols (gamma, eta, beta, ...) and give each a \
human-readable `label` with the symbol, plus a `unit` when it has one.
- Choose ranges that keep the numerics stable and the plot interesting at BOTH extremes and \
for every combination of extremes.
- Prefer `scipy.integrate.solve_ivp` with `t_eval` for ODEs (use a fixed `t_eval` grid, \
`rtol`/`atol` set explicitly) or closed-form numpy for algebraic models.
- Include an analytic reference / theoretical-bound series whenever the paper gives one, \
as an extra series.
- Reply with: `title` (the simulation title), `code` (the complete module), `explanation` \
(2-4 sentences: what the plot shows and what to try), `assumptions` (list of simplifications \
you made), `equation_latex` (the main equation in LaTeX, without $ delimiters).
The paper (or the user's description) follows. Hint from the user, if any, is in the text.
"""

REPAIR_PROMPT = f"""\
The simulation module you wrote failed automated validation. Fix it and return the full \
corrected module (same output fields as before).

{CONTRACT}
Fix exactly what the validation report says (error codes: E_STATIC = forbidden construct, \
E_CONTRACT = PARAMS/simulate shape wrong, E_RUNTIME = exception when running, E_OUTPUT = \
invalid result such as NaN, wrong lengths or too many points, E_TIMEOUT = too slow). \
Keep the scientific content; simplify or shorten the integration window / grid if it was \
too slow or unstable.
"""
