"use client";

import React from "react";
import { ArrowLeft, ArrowRight, BookOpen, CircleDashed, ExternalLink, FileText, Quote, X } from "lucide-react";
import type { GraphEdgeData, GraphNodeData } from "../../types/scholartwin";
import { resolveCitationUrl } from "../../api/citations";
import { connectionsOf, type HypothesisModel, type NodeKind } from "./model";

const KIND_META: Record<NodeKind, { label: string; color: string; icon: typeof BookOpen }> = {
  paper: { label: "Paper", color: "var(--accent)", icon: BookOpen },
  claim: { label: "Claim", color: "var(--text-secondary)", icon: FileText },
  gap: { label: "Open question", color: "var(--status-gap)", icon: CircleDashed },
};

const EDGE_META: Record<GraphEdgeData["type"], { label: string; color: string }> = {
  supports: { label: "Agree", color: "var(--status-support)" },
  contradicts: { label: "Contradict", color: "var(--status-contradict)" },
  gap: { label: "Open question", color: "var(--status-gap)" },
  prerequisite: { label: "Prerequisite", color: "var(--accent)" },
};

/** Link to the paper (arXiv / DOI / OpenAlex …, else a Scholar search). */
export function paperUrl(paper: GraphNodeData): string | undefined {
  return resolveCitationUrl({ docId: paper.doc_id || paper.id, citation: paper.authors_year, title: paper.label });
}

/**
 * Floating glass bubble docked to the bottom of the canvas, centred once the canvas is wide.
 * The zoom controls sit top-left and the Live tutor button in the sheet's footer lane, so the
 * bubble never covers either. It keeps the top of the canvas for the focused node (>= 15rem
 * tall on short canvases so the header always fits).
 *
 * The `header` (kind pill, title, citation, list label) stays put; only the `children` list
 * below it scrolls, so the glass scrollbar runs beside the list, never the whole card.
 */
function Shell({
  label,
  onClose,
  header,
  children,
}: {
  label: string;
  onClose: () => void;
  header: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="apple-glass-elevated apple-materialize absolute bottom-3 left-3 right-3 z-20 mx-auto flex max-h-[max(48%,15rem)] max-w-xl flex-col overflow-hidden rounded-[24px] border"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        title="Close (Esc)"
        className="apple-press apple-focus absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className={`shrink-0 px-4 pr-12 pt-4 ${children ? "pb-1" : "pb-4"}`}>{header}</div>
      {children && (
        // The only scroller. Its inner padding keeps the cards' borders and focus rings inside the
        // clip box; the scrollbar takes its own gutter, so it never sits on the text.
        // Margins (not padding) so the scroll viewport, and its scrollbar, stop short of the rim.
        <div className="mx-3 mb-3 min-h-0 flex-1 overflow-y-auto">
          <div className="p-1">{children}</div>
        </div>
      )}
    </div>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
    >
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="apple-label mb-1.5 text-[10px] font-semibold uppercase text-[var(--text-muted)]">{children}</p>;
}

/** Authors / year with a button that opens the paper. */
function Citation({ paper }: { paper: GraphNodeData }) {
  const url = paperUrl(paper);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {paper.authors_year && (
        <span
          className="text-xs font-semibold"
          style={{ color: "color-mix(in srgb, var(--accent) 82%, var(--text-primary))" }}
        >
          {paper.authors_year}
        </span>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "color-mix(in srgb, var(--accent) 82%, var(--text-primary))" }}
          className="apple-press apple-focus inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] font-semibold hover:opacity-90"
        >
          Open paper
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/** Floating details for a clicked node. */
export function NodeBubble({
  model,
  node,
  onSelectNode,
  onShowEdge,
  onClose,
  highlightClaimId,
}: {
  model: HypothesisModel;
  node: GraphNodeData;
  onSelectNode: (id: string) => void;
  onShowEdge: (edge: GraphEdgeData) => void;
  onClose: () => void;
  /** A claim picked in the side panel: it's marked and scrolled into view. */
  highlightClaimId?: string | null;
}) {
  const kind = model.kind(node.id);
  const meta = KIND_META[kind];
  const KindIcon = meta.icon;
  const claims = model.claimsOf.get(node.id) ?? [];
  const links = connectionsOf(model, node.id);
  const papersLinked = links.filter((l) => l.edge.type !== "gap");
  const gapsLeft = links.filter((l) => l.edge.type === "gap");

  const row = (l: (typeof links)[number]) => {
    const why = model.linksOf.get(l.edge.id) ?? [];
    return (
      <li key={l.edge.id} className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => onSelectNode(l.other.id)}
          title={`Go to: ${l.other.label}`}
          // Baseline-aligned: the verb sits on the first line of the (possibly wrapping) target.
          className="apple-press apple-focus flex min-w-0 flex-1 items-baseline gap-2 rounded-lg px-2 py-1 text-left leading-snug hover:bg-[var(--bg-surface-muted)]"
        >
          <span className="shrink-0 text-[11px] font-semibold" style={{ color: l.color }}>
            {l.verb}
          </span>
          <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-primary)]">
            {model.kind(l.other.id) === "paper" && l.other.authors_year ? (
              <>
                <span className="font-semibold">{l.other.authors_year}</span>
                <span className="text-[var(--text-muted)]"> · {l.other.label}</span>
              </>
            ) : (
              l.other.label
            )}
          </span>
        </button>
        {why.length > 0 && (
          <button
            type="button"
            onClick={() => onShowEdge(l.edge)}
            title="Show which claims, with quotes"
            className="apple-press apple-focus mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <Quote className="h-2.5 w-2.5" />
            Why
          </button>
        )}
      </li>
    );
  };

  // With claims listed, their links already say who agrees / disagrees; otherwise list the
  // linked papers, then the open questions. A paper keeps its one list label in the fixed
  // header (so the scroll box holds just the rows); an open question's description and labels
  // scroll with its list, so a long description can't crowd the list out on a small canvas.
  const showLinked = claims.length === 0 && papersLinked.length > 0;
  const showGaps = claims.length === 0 && gapsLeft.length > 0;
  const gapsLabel = kind === "gap" ? "Raised by" : `Open questions · ${gapsLeft.length}`;
  const standsAlone = kind !== "gap" && links.length === 0;
  const summary = kind !== "paper" && node.summary && node.summary !== node.label ? node.summary : null;
  const headerLabel =
    kind !== "paper"
      ? null
      : claims.length > 0
        ? `What this paper claims · ${claims.length}`
        : showLinked && !showGaps
          ? `Linked papers · ${papersLinked.length}`
          : showGaps && !showLinked
            ? gapsLabel
            : null;
  const inlineLabels = !headerLabel;
  const hasBody = claims.length > 0 || showLinked || showGaps || standsAlone || !!summary;

  return (
    <Shell
      label={`${meta.label} details`}
      onClose={onClose}
      header={
        <>
          <Pill color={meta.color}>
            <KindIcon className="h-3 w-3" />
            {meta.label}
          </Pill>
          <h3 className="apple-heading mt-2 break-words text-sm font-semibold leading-snug text-[var(--text-primary)]">{node.label}</h3>
          {kind === "paper" && <Citation paper={node} />}
          {headerLabel && (
            <div className="mt-3 -mb-1.5">
              <Label>{headerLabel}</Label>
            </div>
          )}
        </>
      }
    >
      {hasBody && (
        <>
          {summary && <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">{summary}</p>}

          {claims.length > 0 && (
            <ul className="space-y-1.5">
              {claims.map((c) => (
                <ClaimCard
                  key={c.id}
                  model={model}
                  claim={c}
                  highlight={c.id === highlightClaimId}
                  onSelectNode={onSelectNode}
                  onShowEdge={onShowEdge}
                />
              ))}
            </ul>
          )}

          {showLinked && (
            <div>
              {inlineLabels && <Label>Linked papers · {papersLinked.length}</Label>}
              <ul className="space-y-1">{papersLinked.map(row)}</ul>
            </div>
          )}

          {showGaps && (
            <div className={showLinked ? "mt-3" : ""}>
              {inlineLabels && <Label>{gapsLabel}</Label>}
              <ul className="space-y-1">{gapsLeft.map(row)}</ul>
            </div>
          )}

          {standsAlone && (
            <p className="rounded-xl border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
              <span className="font-semibold">Stands alone.</span> No other paper in this search agrees or disagrees
              with it, and it raises no open question, so it&apos;s greyed out on the graph.
            </p>
          )}
        </>
      )}
    </Shell>
  );
}

const CLAIM_VERB: Record<GraphEdgeData["type"], string> = {
  supports: "Agrees with",
  contradicts: "Contradicts",
  gap: "Leaves open",
  prerequisite: "Leads to",
};

/** Short "what it links to" chips for one claim. */
export function ClaimLinks({
  model,
  claimId,
  onSelectNode,
  onShowEdge,
}: {
  model: HypothesisModel;
  claimId: string;
  onSelectNode?: (id: string) => void;
  onShowEdge?: (edge: GraphEdgeData) => void;
}) {
  const rels = model.claimLinks.get(claimId) ?? [];
  if (rels.length === 0) {
    return <p className="mt-1 text-[10.5px] italic text-[var(--text-muted)]">Not linked to another paper or open question</p>;
  }
  return (
    <ul className="mt-1.5 space-y-1">
      {rels.map((r, i) => {
        const color = EDGE_META[r.type].color;
        const target = r.type === "gap" ? r.other.label : r.other.authors_year || r.other.label;
        return (
          <li key={`${r.line.id}-${i}`} className="flex items-start gap-2 text-[10.5px] leading-[1.5]">
            {/* One line of text: glyph, verb and target all share the first line's baseline.
                (A block-level clamp inside the target button used to drop the verb onto the
                button's last line, so the three sat at different heights.) The clamp applies
                to the whole line instead. */}
            <p className={`min-w-0 flex-1 ${r.type === "gap" ? "line-clamp-3" : ""}`}>
              <span
                aria-hidden
                className="mr-1.5 inline-block w-3 border-t-2 align-middle"
                style={{ borderColor: color, borderTopStyle: r.type === "supports" ? "solid" : "dashed" }}
              />
              <span className="font-semibold" style={{ color: `color-mix(in srgb, ${color} 80%, var(--text-primary))` }}>
                {CLAIM_VERB[r.type]}
              </span>{" "}
              {onSelectNode ? (
                // A real inline element (Chrome lays a <button> out as an inline-block box even
                // with display:inline), so a long target wraps as text and keeps the baseline.
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(r.other.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectNode(r.other.id);
                    }
                  }}
                  className="apple-focus cursor-pointer rounded font-medium text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-2 hover:decoration-[var(--text-primary)]"
                >
                  {target}
                </span>
              ) : (
                <span className="font-medium text-[var(--text-primary)]">{target}</span>
              )}
              {r.otherClaim && <span className="text-[var(--text-muted)]"> — “{r.otherClaim.label}”</span>}
            </p>
            {onShowEdge && r.type !== "gap" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowEdge(r.line);
                }}
                title="Show the evidence, with quotes"
                className="apple-press apple-focus mt-px flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-1.5 py-px text-[9.5px] font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                <Quote className="h-2.5 w-2.5" />
                Why
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ClaimCard({
  model,
  claim,
  highlight,
  onSelectNode,
  onShowEdge,
}: {
  model: HypothesisModel;
  claim: GraphNodeData;
  highlight: boolean;
  onSelectNode: (id: string) => void;
  onShowEdge: (edge: GraphEdgeData) => void;
}) {
  const ref = React.useRef<HTMLLIElement | null>(null);
  React.useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);
  return (
    <li
      ref={ref}
      className={`rounded-xl border px-2.5 py-1.5 transition ${
        highlight
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent-border)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]"
      }`}
    >
      <p className="text-[11.5px] leading-snug text-[var(--text-primary)]">{claim.label}</p>
      <ClaimLinks model={model} claimId={claim.id} onSelectNode={onSelectNode} onShowEdge={onShowEdge} />
    </li>
  );
}

/** Floating explanation for a clicked line: the claims behind it, with quotes. */
export function EdgeBubble({
  model,
  edge,
  onSelectNode,
  onBack,
  onClose,
}: {
  model: HypothesisModel;
  edge: GraphEdgeData;
  onSelectNode: (id: string) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const meta = EDGE_META[edge.type];
  const source = model.byId.get(edge.source);
  const target = model.byId.get(edge.target);
  const links = model.linksOf.get(edge.id) ?? [];
  const name = (n: GraphNodeData | undefined, id: string) => (
    <button
      type="button"
      onClick={() => onSelectNode(id)}
      className="apple-press apple-focus min-w-0 rounded-lg px-1.5 py-0.5 text-left text-xs font-semibold text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-2 hover:bg-[var(--bg-surface-muted)]"
    >
      {n ? (model.kind(n.id) === "paper" && n.authors_year) || n.label : id}
    </button>
  );
  const author = (claim: GraphNodeData) => model.byId.get(model.resolveId(claim.id) ?? "")?.authors_year;

  return (
    <Shell
      label={`${meta.label} link`}
      onClose={onClose}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="apple-press apple-focus flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
            )}
            <Pill color={meta.color}>{meta.label}</Pill>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1 pb-1.5 text-xs text-[var(--text-secondary)]">
            {name(source, edge.source)}
            <span className="text-[11px]" style={{ color: meta.color }}>
              {edge.type === "supports" ? "and" : edge.type === "contradicts" ? "vs" : "leaves open"}
            </span>
            {name(target, edge.target)}
          </div>
        </>
      }
    >
      <div className="space-y-2.5">
        {links.map(({ edge: e, from, to }, i) => (
          <div key={`${e.id}-${i}`} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
            <p className="text-[11.5px] leading-snug text-[var(--text-primary)]">
              {author(from) && <span className="font-semibold">{author(from)}: </span>}
              {from.label}
            </p>
            <p className="my-1 flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: meta.color }}>
              <ArrowRight className="h-3 w-3" />
              {e.type === "supports" ? "agrees with" : e.type === "contradicts" ? "contradicts" : "leaves open"}
            </p>
            <p className="text-[11.5px] leading-snug text-[var(--text-primary)]">
              {model.kind(model.resolveId(to.id) ?? "") !== "gap" && author(to) && (
                <span className="font-semibold">{author(to)}: </span>
              )}
              {to.label.replace(/^untested\s*:\s*/i, "")}
            </p>
            {(e.label || e.condition) && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{e.label || e.condition}</p>
            )}
            {e.evidence?.map((ev, j) => (
              <blockquote
                key={`${ev.paper_id}-${j}`}
                style={{ borderLeftColor: meta.color }}
                className="mt-1.5 border-l-[3px] pl-2 text-[11px] italic text-[var(--text-secondary)]"
              >
                “{ev.quote}”
                {model.byId.get(ev.paper_id)?.authors_year && (
                  <span className="not-italic text-[var(--text-muted)]"> · {model.byId.get(ev.paper_id)!.authors_year}</span>
                )}
              </blockquote>
            ))}
          </div>
        ))}
      </div>
    </Shell>
  );
}
