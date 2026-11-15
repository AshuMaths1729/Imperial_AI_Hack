/** Tiny dependency-free Python tokenizer for display-only syntax highlighting. */

export type TokType = "kw" | "const" | "builtin" | "self" | "str" | "num" | "com" | "def" | "call" | "deco" | "op" | "plain";

export interface Tok {
  t: TokType;
  s: string;
}

const KW = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
  "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not",
  "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case",
]);
const CONST = new Set(["True", "False", "None"]);
const BUILTIN = new Set([
  "abs", "all", "any", "bool", "dict", "enumerate", "float", "int", "len", "list", "map", "max", "min",
  "print", "range", "round", "set", "sorted", "str", "sum", "tuple", "zip", "isinstance", "reversed",
  "np", "numpy", "math", "scipy", "pow", "filter",
]);

const RE = new RegExp(
  [
    "(#[^\\n]*)", // 1 comment
    "((?:[rRbBuUfF]{1,2})?(?:\"\"\"[\\s\\S]*?(?:\"\"\"|$)|'''[\\s\\S]*?(?:'''|$)|\"(?:\\\\.|[^\"\\\\\\n])*\"?|'(?:\\\\.|[^'\\\\\\n])*'?))", // 2 string
    "((?:0[xX][0-9a-fA-F_]+|(?:\\d[\\d_]*\\.?[\\d_]*|\\.\\d[\\d_]*)(?:[eE][+-]?\\d+)?j?))", // 3 number
    "(@[A-Za-z_][\\w.]*)", // 4 decorator
    "([A-Za-z_]\\w*)", // 5 identifier
    "(\\s+)", // 6 whitespace
    "([^\\sA-Za-z_\\d#'\"]+|[\\s\\S])", // 7 operators / anything else
  ].join("|"),
  "g",
);

export function tokenizePython(code: string): Tok[] {
  const out: Tok[] = [];
  let prevSig = "";
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(code)) !== null) {
    if (m[0] === "") {
      RE.lastIndex++;
      continue;
    }
    const s = m[0];
    let t: TokType = "plain";
    if (m[1]) t = "com";
    else if (m[2]) t = "str";
    else if (m[3]) t = "num";
    else if (m[4]) t = "deco";
    else if (m[5]) {
      if (KW.has(s)) t = "kw";
      else if (CONST.has(s)) t = "const";
      else if (s === "self" || s === "cls") t = "self";
      else if (prevSig === "def" || prevSig === "class") t = "def";
      else if (BUILTIN.has(s)) t = "builtin";
      else if (code[RE.lastIndex] === "(") t = "call";
    } else if (m[7]) t = "op";
    if (!m[6]) prevSig = s;
    out.push({ t, s });
  }
  return out;
}

/** Split tokens into lines (multi-line strings / comments are split across lines). */
export function tokensToLines(tokens: Tok[]): Tok[][] {
  const lines: Tok[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.s.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ t: tok.t, s: p });
    });
  }
  return lines;
}

/** Decode \uXXXX / \UXXXXXXXX escapes for display (Python renders them identically). */
export function decodeUnicodeEscapes(code: string): { text: string; decoded: boolean } {
  let decoded = false;
  const text = code
    .replace(/\\U([0-9a-fA-F]{8})/g, (all, h: string) => {
      const cp = parseInt(h, 16);
      if (cp > 0x10ffff) return all;
      decoded = true;
      return String.fromCodePoint(cp);
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_all, h: string) => {
      decoded = true;
      return String.fromCharCode(parseInt(h, 16));
    });
  return { text, decoded };
}

/** Theme-token colour per token type. */
export const TOKEN_CLASS: Record<TokType, string> = {
  kw: "text-[var(--accent)] font-semibold",
  const: "text-[var(--accent)]",
  builtin: "text-[var(--status-gap)]",
  self: "text-[var(--status-gap)] italic",
  str: "text-[var(--status-support)]",
  num: "text-[var(--status-warning)]",
  com: "text-[var(--text-muted)] italic",
  def: "text-[var(--status-contradict)] font-semibold",
  call: "text-[var(--text-primary)] font-medium",
  deco: "text-[var(--status-warning)]",
  op: "text-[var(--text-muted)]",
  plain: "text-[var(--text-primary)]",
};
