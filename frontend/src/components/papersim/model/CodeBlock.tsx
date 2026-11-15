"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { CopyButton } from "../series/kit";
import { TOKEN_CLASS, decodeUnicodeEscapes, tokenizePython, tokensToLines } from "./pythonHighlight";

const COLLAPSED_LINES = 40;

export function CodeBlock({ code, filename = "simulate.py" }: { code: string; filename?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { lines, decoded } = useMemo(() => {
    const { text, decoded } = decodeUnicodeEscapes(code.replace(/\r\n?/g, "\n").replace(/\s+$/, ""));
    return { lines: tokensToLines(tokenizePython(text)), decoded };
  }, [code]);

  const long = lines.length > COLLAPSED_LINES + 8;
  const shown = long && !expanded ? lines.slice(0, COLLAPSED_LINES) : lines;
  const gutter = String(lines.length).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
        </span>
        <span className="ml-1 flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-secondary)]">
          <FileCode2 className="h-3.5 w-3.5 text-[var(--accent)]" />
          {filename}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {lines.length} lines · Python
          {decoded ? " · unicode escapes shown decoded" : ""}
        </span>
        <CopyButton text={code} label="Copy code" className="ml-auto" />
      </div>
      <div className="max-h-[36rem] overflow-auto">
        <pre className="min-w-max py-3 font-mono text-[12px] leading-[1.65]">
          <code>
            {shown.map((toks, i) => (
              <div key={i} className="flex hover:bg-[var(--accent-soft)]">
                <span
                  aria-hidden
                  className="sticky left-0 select-none border-r border-[var(--border-subtle)] bg-[var(--bg-canvas)] pl-3 pr-3 text-right text-[var(--text-muted)] opacity-70"
                  style={{ minWidth: `${gutter + 2.5}ch` }}
                >
                  {i + 1}
                </span>
                <span className="whitespace-pre pl-4 pr-6">
                  {toks.length === 0
                    ? " "
                    : toks.map((t, j) => (
                        <span key={j} className={TOKEN_CLASS[t.t]}>
                          {t.s}
                        </span>
                      ))}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="apple-press apple-focus flex w-full items-center justify-center gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)]"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Collapse" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
