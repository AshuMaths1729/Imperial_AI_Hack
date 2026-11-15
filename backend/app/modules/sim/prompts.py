"""Prompts for Paper2Sim: code generation, repair and docs (versioned: bump on any edit)."""

PROMPT_VERSION = "sim-v3"

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

_AUDIENCE = """\
The reader is a curious beginner: an undergraduate who has not read the paper. Write in \
plain, friendly language and define jargon the first time you use it. Be faithful to the \
paper: never invent results, numbers, equations or quotes. Paper-specific facts must come \
from the document; general background knowledge is fine for explanations.
"""

_SOURCES = """\
Source locations (every `source` object):
- `section`: the section number and name as printed, e.g. "3.2 Forgetting mechanisms"; for \
equations include the paper's equation number, e.g. "Eq. (3), Sec. 2.1".
- `page`: the 1-based page number within the PDF file you were given (the first page of the \
file is 1, whatever page numbers are printed on it). Use 0 when you are not sure; never guess.
- `quote`: a short snippet (at most ~25 words) copied EXACTLY from that place; "" when there \
is no good snippet. For background knowledge that is not from the paper use \
{"section": "", "page": 0, "quote": ""}.
"""

_MATH = """\
How to write math (the app renders $...$ inside prose as LaTeX):
- Prose fields (explanation, assumptions, overview, key_findings, summary, detail, meaning, \
effect, typical, how_to_read, x_meaning, y_meaning, limitations, preset description and \
expected, link explanation, derivation explanation): wrap EVERY mathematical expression, \
symbol or equation in inline $...$ LaTeX, e.g. "retention $R = e^{-t/S}$ decays", "set \
$\\Delta S = 0$", "at times $k\\Delta$". Never bare ASCII math such as "exp(-t/S)", "S_0" \
or "S += dS".
- Pure-LaTeX fields (equation_latex, latex, symbol_latex) are bare LaTeX WITHOUT $ or \
\\( \\) delimiters, e.g. "\\frac{dR}{dt} = -\\lambda R".
- Short labels that are also shown as plain text (title, PARAMS `label`, series names \
returned by simulate(), x_label / y_label, concept `label`, link `relation`, preset `name`, \
equation and derivation `title`): NO LaTeX and no $; write symbols in Unicode ("Initial \
strength S₀", "Recall interval Δ", "Retention R(t)", "ΔS", "x²"), never underscores or \
carets like "S_0" or "x^2".
"""

CODEGEN_PROMPT = f"""\
You turn the key model, equation or algorithm of a scientific paper into a small interactive \
simulation that a student can explore with sliders, and you explain its sliders, scenarios \
and curves. (A later step draws the paper's concept map and equations; not your job here.)
{_AUDIENCE}
{CONTRACT}
# The simulation

Choosing the model:
- Simulate the paper's central quantitative model, equation or algorithm. If the paper has \
no equation of its own (e.g. a survey or position paper), simulate the most central \
quantitative model it describes or cites, and say so in the FIRST sentence of `explanation` \
and the first entry of `assumptions`, naming the cited work (authors, year).
- Include an analytic reference / theoretical bound / baseline as an extra series whenever \
the paper gives one, so the plot shows a comparison rather than a single curve.

Designing the sliders (PARAMS) so a learner can reason about them:
- Expose the 2-5 (at least 1) quantities a reader would most want to vary to understand the \
paper's claim; each must visibly change the plot. No redundant sliders (two knobs with the \
same effect, or a product that only ever appears together: expose the combined quantity \
once). Fix everything else as a named constant.
- Keys are short Python identifiers after the paper's own symbols (gamma, eta, n_layers, ...).
- `label` is human-readable and includes the symbol, e.g. "Decay rate λ", "Memory size N".
- `unit` is a real unit or a plain word ("s", "steps", "tokens", "%"); "" only for pure ratios.
- Ranges: realistic, numerically stable and visually interesting at BOTH extremes and for \
every combination of extremes; `default` reproduces the paper's main setting.
- Steps: integer counts (layers, agents, samples, steps) use integer min/max/default with \
step 1; continuous values use a step giving roughly 20-200 positions across the range.
- Prefer `scipy.integrate.solve_ivp` with a fixed `t_eval` grid and explicit `rtol`/`atol` \
for ODEs, or closed-form numpy for algebraic models. Round integer params inside simulate().
- Series names are short, descriptive plain text ("Retention with rehearsal", "Bound R∞");
`x_label` / `y_label` name the quantity and unit in plain text ("Time t (days)").

# `docs`
{_SOURCES}
- `overview`: 3-5 sentences: the problem, the paper's idea, and what the simulation shows.
- `key_findings`: 3-6 concrete claims or results of the paper, with its numbers where given.
- `params`: one entry per PARAMS key (`key` exactly that key): `symbol_latex`; `meaning` (what \
it is, one plain sentence); `effect` (what moving the slider UP does to the plot, e.g. \
"Curves flatten and the gap to the bound closes"); `typical` (the value(s) the paper uses or \
reports, with where; "" if none); `source`.
- `presets`: 2-4 named scenarios that reproduce something the paper describes (a regime, a \
reported setting, an ablation, an extreme case it discusses). `values` set each PARAMS key \
(exact keys, each within its [min, max]); `description` says what the scenario is, \
`expected` what the learner should see in the plot, `source` where the paper discusses it.
- `series`: one entry per series simulate() returns at the defaults, `name` EXACTLY equal \
to the series name; `meaning` (what the curve represents) and `how_to_read` (how to \
interpret its shape: what rising / falling / crossing means).
- `x_meaning` / `y_meaning`: what the axes measure, with units.
- `limitations`: 2-5 honest limits of the simulation compared to the paper.

{_MATH}
# Reply
`paper_title` (the source paper's exact title as printed on it; "" if the input is only a \
description), `title` (the simulation title), `code` (the complete module), `explanation` \
(2-4 sentences: what the plot shows and what to try), `assumptions` (simplifications you \
made), `equation_latex` (the main equation) and `docs`.
The paper (or the user's description) follows. Hint from the user, if any, is in the text.
"""

DOCS_PROMPT = f"""\
A scientific paper and an interactive simulation built from it (its sliders = PARAMS, its \
curves, its code) follow. Write the material that teaches the paper's model through the \
simulation: the equations, a derivation, a glossary and a concept & parameter map. Fill \
EVERY list completely; none of them may be empty.
{_AUDIENCE}
{_SOURCES}
`equations` (3-8): every equation behind the simulated model, the main one first, then \
supporting definitions, update rules, bounds and the closed forms the code uses. Each has a \
unique `id`, a short `title`, `latex`, a plain `explanation` of what it says, `variables` \
(each symbol in it and its meaning) and `source`. When the paper (e.g. a survey) states the \
idea only in words or cites it, still write the equation the code implements, say in its \
`explanation` where the idea comes from (the paper's words or the cited work), and point \
`source` at the passage that describes it.
`derivation` (3-6 steps): how the simulated equations follow from the paper's starting \
point or first principles: `title`, `latex` ("" if none) and `explanation`.
`glossary` (5-15): the symbols and terms a beginner needs (symbol or term in \
`symbol_latex`, plain `meaning`).

`concepts` (12-30): the nodes of a concept & parameter map of the paper. Cover ALL concepts, \
quantities and parameters in the paper that matter for the simulated model. Ids are short \
unique snake_case strings. Include:
- exactly one root node with id "paper" and kind "paper" (label: the paper's short title);
- one kind "model" node for the simulated model; when it comes from a cited work (e.g. in a \
survey), kind "cited_work" nodes for the works the model or its parameters come from, \
labelled "Author et al. (year)";
- one kind "parameter" node per PARAMS key with `param_key` set to that key (id e.g. \
"param_gamma"); every other node has `param_key` "";
- kind "variable" for other quantities (state variables, outputs, fixed constants), \
"concept" for ideas and mechanisms, "assumption" for modelling assumptions, "result" for \
findings / predictions the simulation illustrates;
- each with `summary` (one beginner-friendly sentence), `detail` (2-4 sentences: why it \
matters and how it works), `latex` (its defining formula or symbol, "" if none), `source`, \
and `parents`: its incoming links.

The links form a readable top-down DAG flowing from the root: paper -> model (and cited \
works) -> concepts / variables / parameters / assumptions -> results. List concepts top-down \
(the root first, every concept after all of its parents). The root has `parents` []; every \
other concept has at least one parent, and may have more (a result can be predicted by the \
model and driven by a parameter). Each parent is:
- `source`: the id of a concept listed EARLIER;
- `relation`: a specific verb phrase that reads naturally as "<parent> <relation> <this \
concept>", e.g. "slows the decay of", "is estimated from", "sets the capacity of", "trades \
off against", "is approximated by", "predicts". Never vague words like "governs", "relates \
to", "affects", "involves", "includes";
- `explanation`: one sentence on why the link holds, in the paper's terms;
- `kind`: "prerequisite" for structure / dependence (the default), "supports" when the parent \
is evidence for this concept, "contradicts" for a tension, "gap" for an open question.

{_MATH}"""

REPAIR_PROMPT = f"""\
The simulation module you wrote failed automated validation. Fix it and return the full \
corrected module with its `title`, `explanation`, `assumptions` and `equation_latex`.

{CONTRACT}
Fix exactly what the validation report says (error codes: E_STATIC = forbidden construct, \
E_CONTRACT = PARAMS/simulate shape wrong, E_RUNTIME = exception when running, E_OUTPUT = \
invalid result such as NaN, wrong lengths or too many points, E_TIMEOUT = too slow). \
Keep the scientific content; simplify or shorten the integration window / grid if it was \
too slow or unstable. Keep the PARAMS keys and the series names unchanged unless the report \
says they are wrong (explanatory material written earlier refers to them).

{_MATH}"""
