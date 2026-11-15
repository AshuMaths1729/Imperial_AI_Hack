/**
 * Helpers that make "math written as plain text" render properly.
 *
 * Model-generated text often contains math without `$..$` delimiters ("R = exp(-t/S)",
 * "ΔS = 1", "S_0", "k = 1..n"). `splitAutoMath` finds those spans conservatively so
 * `RichText` can typeset them with KaTeX, `plainToLatex` turns them into LaTeX, and
 * `prettyMath` turns LaTeX / ASCII math into Unicode for places that cannot hold HTML
 * (`<option>`, SVG `<text>`, `title` attributes, CSV).
 */

const G = "α-ωΑ-Ωϑϕϵϱϖ";
const FN_NAMES = "exp|log|ln|sin|cos|tan|tanh|sinh|cosh|sqrt|max|min|abs|arg";
const FN = `(?:${FN_NAMES})\\((?:[^()]|\\([^()]*\\))*\\)`;
const SUB = `_(?:\\{[^{}]+\\}|[A-Za-z0-9]+)`;
const SUP = `\\^(?:\\{[^{}]+\\}|[-+]?[A-Za-z0-9.]+)`;
const NUM = `\\d+(?:\\.\\d+)?`;
const SYM = `[A-Za-z${G}](?:${SUB})?(?:${SUP})?`;
const PAREN = `\\((?:[^()]|\\([^()]*\\))*\\)`;
const ATOM = `(?:${FN}|${NUM}(?:${SUP})?|${SYM}|[₀-₉²³¹⁰-⁹])`;
const ATOMS = `(?:${ATOM})+(?:${PAREN})?`;
const JOIN = `(?:[-+*/·]|\\.\\.|…)`;
const OP = `(?:\\+=|-=|<=|>=|!=|==|=|→|->|⇒|≈|≤|≥|∝|<|>)`;
const START = `(?<![A-Za-z${G}0-9_\\\\$])`;
const END = `(?![A-Za-z${G}0-9_])`;

/** "LHS op RHS", e.g. "R = exp(-t/S)", "S += ΔS", "k = 1..n", "S → αS". */
const EQUATION = `${START}${ATOMS}\\s*${OP}\\s*-?${ATOMS}(?:\\s*${JOIN}\\s*${ATOMS})*${END}`;
/** A space-free symbolic token: "kΔ", "S_0", "x^2", "S0·ln(1/θ)", "exp(-t/S0)". */
const TOKEN = `${START}-?${ATOMS}(?:${JOIN}-?${ATOMS})*${END}`;
/** Raw LaTeX that lost its delimiters: "\\Delta", "\\frac{1}{2}". */
const RAW_TEX = `\\\\[A-Za-z]+(?:\\{[^{}\\s]*\\}|[_^](?:\\{[^{}]*\\}|[A-Za-z0-9]))*`;

const AUTO_RE = new RegExp(`(${RAW_TEX}|${EQUATION}|${TOKEN})`, "gu");
const FN_RE = new RegExp(`\\b(?:${FN_NAMES})\\(`, "g");

/** Reject candidates that are really prose (English words, plain numbers, ...). */
function looksLikeMath(s: string): boolean {
  if (s.startsWith("\\")) return true;
  const core = s.replace(new RegExp(SUB, "g"), "").replace(FN_RE, "(");
  // A run of 4+ Latin letters outside subscripts / function names is a word, not math.
  if (/[A-Za-z]{4,}/.test(core)) return false;
  const hasOp = new RegExp(OP).test(s);
  const hasGreek = new RegExp(`[${G}]`).test(s);
  const hasScript = /[_^₀-₉²³¹⁰-⁹]/.test(s);
  const hasFn = new RegExp(`\\b(?:${FN_NAMES})\\(`).test(s);
  if (hasOp) {
    // Equations need something symbolic on the left: a 1-3 letter symbol, greek, or a script.
    const lhs = s.split(new RegExp(`\\s*${OP}`))[0].replace(PAREN_RE, "");
    if (!LHS_RE.test(lhs)) return false;
    // "a = 5" style one-letter-English risk is acceptable; "I = 3" too.
    return true;
  }
  return hasGreek || hasScript || hasFn;
}
const PAREN_RE = new RegExp(PAREN, "g");
const LHS_RE = new RegExp(`^-?(?:[A-Za-z]{1,3}|.*[${G}_^₀-₉].*)$`, "u");
const PRETTY_SUB_RE = new RegExp(
  `([A-Za-z${G})])_\\{([^{}]+)\\}|([A-Za-z${G})])_([A-Za-z0-9]+)`,
  "gu"
);
const PRETTY_SUP_RE = new RegExp(
  `([A-Za-z0-9${G})])\\^\\{([^{}]+)\\}|([A-Za-z0-9${G})])\\^([-+]?[A-Za-z0-9]+)`,
  "gu"
);

export interface MathSegment {
  math: boolean;
  text: string;
}

/** Split plain prose into text / math segments (no `$` delimiters expected here). */
export function splitAutoMath(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(AUTO_RE)) {
    const raw = m[0];
    const start = m.index ?? 0;
    // Trailing sentence punctuation is never part of the math.
    const trimmed = raw.replace(/[.,;:]+$/, "");
    if (!trimmed || !looksLikeMath(trimmed)) continue;
    if (start > last) out.push({ math: false, text: text.slice(last, start) });
    out.push({ math: true, text: trimmed });
    last = start + trimmed.length;
  }
  if (last < text.length) out.push({ math: false, text: text.slice(last) });
  return out;
}

const SUB_DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};
const SUP_DIGITS: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};

/** Plain-text math ("R = exp(-t/S_0)", "k = 1..n") -> LaTeX for KaTeX. */
export function plainToLatex(s: string): string {
  if (s.startsWith("\\")) return s; // already LaTeX
  let t = s;
  t = t.replace(/sqrt\(((?:[^()]|\([^()]*\))*)\)/g, "\\sqrt{$1}");
  t = t.replace(/abs\(((?:[^()]|\([^()]*\))*)\)/g, "\\left|$1\\right|");
  t = t.replace(/\b(exp|log|ln|sin|cos|tan|tanh|sinh|cosh|max|min|arg)\(/g, "\\$1(");
  t = t
    .replace(/\+=/g, "\\mathrel{+}=")
    .replace(/-=/g, "\\mathrel{-}=")
    .replace(/<=|≤/g, "\\le ")
    .replace(/>=|≥/g, "\\ge ")
    .replace(/!=/g, "\\ne ")
    .replace(/==/g, "=")
    .replace(/->|→/g, "\\to ")
    .replace(/⇒/g, "\\Rightarrow ")
    .replace(/≈/g, "\\approx ")
    .replace(/∝/g, "\\propto ")
    .replace(/\.\.|…/g, "\\ldots ")
    .replace(/[*·]/g, "\\cdot ");
  t = t.replace(/[₀-₉]+/g, (d) => `_{${[...d].map((c) => SUB_DIGITS[c]).join("")}}`);
  t = t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (d) => `^{${[...d].map((c) => SUP_DIGITS[c]).join("")}}`);
  // A lone symbol followed by digits is an index: S0 -> S_{0}, θ12 -> θ_{12}.
  t = t.replace(new RegExp(`(?<![A-Za-z${G}0-9_\\\\])([A-Za-z${G}])(\\d+)(?![\\d.])`, "gu"), "$1_{$2}");
  // Multi-character sub/superscripts need braces: S_rev -> S_{rev}, x^-1 -> x^{-1}.
  t = t.replace(/_([A-Za-z0-9]{2,})/g, "_{$1}");
  t = t.replace(/\^([-+]?[A-Za-z0-9.]{2,})/g, "^{$1}");
  return t;
}

/* ---------------------------------------------------------------- Unicode fallback */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ",
  chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};
const SYMBOLS: Record<string, string> = {
  cdot: "·", times: "×", to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", le: "≤",
  leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", sim: "∼", propto: "∝",
  infty: "∞", partial: "∂", nabla: "∇", sum: "Σ", prod: "Π", int: "∫", ldots: "…", cdots: "⋯",
  pm: "±", mp: "∓", in: "∈", sqrt: "√", ell: "ℓ", dot: "", hat: "", bar: "", tilde: "",
  exp: "exp", log: "log", ln: "ln", sin: "sin", cos: "cos", tan: "tan", max: "max", min: "min",
};
const SUB_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ",
  k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};
const SUP_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};

function script(body: string, map: Record<string, string>, marker: string): string {
  const chars = [...body];
  return chars.every((c) => map[c]) ? chars.map((c) => map[c]).join("") : `${marker}${body}`;
}

function latexToUnicode(src: string): string {
  let t = src;
  t = t.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b\s*/g, "");
  t = t.replace(/\\(?:,|;|:|!|quad|qquad)\s*/g, " ");
  t = t.replace(/\\(?:text|mathrm|mathit|mathbf|operatorname|mathcal|mathbb)\{([^{}]*)\}/g, "$1");
  for (let i = 0; i < 3; i++) t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  t = t.replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? SYMBOLS[name] ?? name);
  t = t.replace(/_\{([^{}]*)\}|_([A-Za-z0-9])/g, (_m, a?: string, b?: string) => script(a ?? b ?? "", SUB_MAP, "_"));
  t = t.replace(/\^\{([^{}]*)\}|\^([-+]?[A-Za-z0-9])/g, (_m, a?: string, b?: string) => script(a ?? b ?? "", SUP_MAP, "^"));
  t = t.replace(/[{}]/g, "");
  t = t.replace(/\((\w)\)\/\((\w)\)/g, "$1/$2");
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * LaTeX or ASCII math -> readable Unicode, for contexts that cannot render HTML.
 * "Initial strength S_0" -> "Initial strength S₀"; "$\\Delta S$ gain" -> "ΔS gain".
 */
export function prettyMath(text: string | null | undefined): string {
  if (!text) return "";
  let t = text.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$|\\\((.+?)\\\)/g, (_m, a?: string, b?: string, c?: string) =>
    latexToUnicode(a ?? b ?? c ?? "")
  );
  if (/\\[A-Za-z]/.test(t)) t = latexToUnicode(t);
  // ASCII scripts in otherwise plain labels: S_0 -> S₀, x^2 -> x², S_{rev} -> S_rev.
  // Groups: 1/2 = braced base/body, 3/4 = bare base/body (unmatched groups are undefined).
  t = t.replace(PRETTY_SUB_RE, (...g: (string | undefined)[]) => (g[1] ?? g[3] ?? "") + script(g[2] ?? g[4] ?? "", SUB_MAP, "_"));
  t = t.replace(PRETTY_SUP_RE, (...g: (string | undefined)[]) => (g[1] ?? g[3] ?? "") + script(g[2] ?? g[4] ?? "", SUP_MAP, "^"));
  return t;
}
