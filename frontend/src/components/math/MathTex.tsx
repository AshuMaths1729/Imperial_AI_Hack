"use client";

/**
 * Shared LaTeX rendering for PaperSim (KaTeX). Colours inherit `currentColor`, so it follows
 * the light / dark / contrast theme automatically.
 *
 *   <Tex latex="R(t)=e^{-t/S}" />            inline
 *   <Tex latex="..." display />              block (centred, scrolls horizontally if wide)
 *   <RichText text="Retention $R$ decays" /> prose with $..$, $$..$$, \(..\), \[..\] segments
 */
import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { plainToLatex, splitAutoMath } from "./autoMath";

function render(latex: string, display: boolean): string {
  return katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "htmlAndMathml",
  });
}

/** Strip surrounding $ / $$ / \( \) / \[ \] delimiters the model sometimes adds anyway. */
export function stripDelimiters(latex: string): string {
  const s = latex.trim();
  const pairs: [string, string][] = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [open, close] of pairs) {
    if (s.startsWith(open) && s.endsWith(close) && s.length > open.length + close.length) {
      return s.slice(open.length, s.length - close.length).trim();
    }
  }
  return s;
}

export function Tex({
  latex,
  display = false,
  className = "",
}: {
  latex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(() => render(stripDelimiters(latex), display), [latex, display]);
  if (display) {
    // A block-level <span> (not <div>) so display math stays valid inside <p>/<span> prose;
    // KaTeX's own output is phrasing content (spans + MathML) too.
    return (
      <span
        className={`block overflow-x-auto overflow-y-hidden py-1 ${className}`}
        // KaTeX output with trust:false; input is model text, never raw user HTML.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

const SEGMENT_RE = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

type Piece = { kind: "text" | "inline" | "display"; value: string };

function toPieces(text: string, auto: boolean): Piece[] {
  const out: Piece[] = [];
  for (const part of text.split(SEGMENT_RE)) {
    if (!part) continue;
    if (part.startsWith("$$") || part.startsWith("\\[")) out.push({ kind: "display", value: part });
    else if (part.startsWith("\\(") || /^\$[^$]/.test(part)) out.push({ kind: "inline", value: part });
    else if (!auto) out.push({ kind: "text", value: part });
    else
      for (const seg of splitAutoMath(part))
        out.push(seg.math ? { kind: "inline", value: plainToLatex(seg.text) } : { kind: "text", value: seg.text });
  }
  return out;
}

/**
 * Prose or a label that may contain math: explicit `$..$` / `$$..$$` / `\(..\)` / `\[..\]`
 * segments, and (with `auto`, the default) math written as plain text such as
 * "R = exp(-t/S)", "ΔS = 1" or "S_0", which is detected and typeset too.
 */
export function RichText({
  text,
  className = "",
  auto = true,
}: {
  text: string;
  className?: string;
  auto?: boolean;
}) {
  const pieces = useMemo(() => toPieces(text ?? "", auto), [text, auto]);
  return (
    <span className={className}>
      {pieces.map((p, i) =>
        p.kind === "display" ? (
          <Tex key={i} latex={p.value} display />
        ) : p.kind === "inline" ? (
          <Tex key={i} latex={p.value} />
        ) : (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        )
      )}
    </span>
  );
}

export { prettyMath } from "./autoMath";
