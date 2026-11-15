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

function Shell({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className="apple-glass-elevated apple-materialize absolute bottom-4 left-4 right-4 z-20 mx-auto flex max-h-[48%] max-w-xl flex-col overflow-hidden rounded-2xl border"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        title="Close (Esc)"
        className="apple-press apple-focus absolute right-2.5 top-2.5 z-10 rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface-muted)] hover:text-[var(--text-primary)]"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="overflow-y-auto p-4 pr-10">{children}</div>
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
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold"
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
          className="apple-press apple-focus inline-flex items-center gap-1 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold hover:opacity-90"
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
          className="apple-press apple-focus flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1 text-left hover:bg-[var(--bg-surface-muted)]"
        >
          <span className="mt-px shrink-0 text-[11px] font-semibold" style={{ color: l.color }}>
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
            className="apple-press apple-focus mt-0.5 flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <Quote className="h-2.5 w-2.5" />
            Why
          </button>
        )}
      </li>
    );
  };

  return (
    <Shell label={`${meta.label} details`} onClose={onClose}>
      <Pill color={meta.color}>
        <KindIcon className="h-3 w-3" />
        {meta.label}
      </Pill>
      <h3 className="apple-heading mt-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">{node.label}</h3>
      {kind === "paper" ? (
        <Citation paper={node} />
      ) : (
        node.summary &&
        node.summary !== node.label && (
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">{node.summary}</p>
        )
      )}

      {claims.length > 0 && (
        <div className="mt-3">
          <Label>What this paper claims · {claims.length}</Label>
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
        </div>
      )}

      {/* With claims listed, their links already say who agrees / disagrees. */}
      {claims.length === 0 && papersLinked.length > 0 && (
        <div className="mt-3">
          <Label>Linked papers · {papersLinked.length}</Label>
          <ul className="space-y-1">{papersLinked.map(row)}</ul>
        </div>
      )}

      {claims.length === 0 && gapsLeft.length > 0 && (
        <div className="mt-3">
          <Label>{kind === "gap" ? "Raised by" : `Open questions · ${gapsLeft.length}`}</Label>
          <ul className="space-y-1">{gapsLeft.map(row)}</ul>
        </div>
      )}

      {kind !== "gap" && links.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-[var(--border-strong)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)]">
          <span className="font-semibold">Stands alone.</span> No other paper in this search agrees or disagrees
          with it, and it raises no open question, so it&apos;s greyed out on the graph.
        </p>
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
          <li key={`${r.line.id}-${i}`} className="flex items-start gap-1.5 text-[10.5px] leading-snug">
            <span aria-hidden className="mt-[5px] h-0 w-3 shrink-0 border-t-2" style={{ borderColor: color, borderTopStyle: r.type === "supports" ? "solid" : "dashed" }} />
            <span className="min-w-0 flex-1">
              <span className="font-semibold" style={{ color: `color-mix(in srgb, ${color} 80%, var(--text-primary))` }}>
                {CLAIM_VERB[r.type]}{" "}
              </span>
              {onSelectNode ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(r.other.id);
                  }}
                  className="apple-focus rounded text-left font-medium text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-2 hover:decoration-[var(--text-primary)]"
                >
                  {r.type === "gap" ? <span className="line-clamp-2">{target}</span> : target}
                </button>
              ) : (
                <span className="font-medium text-[var(--text-primary)]">{target}</span>
              )}
              {r.otherClaim && <span className="text-[var(--text-muted)]"> — “{r.otherClaim.label}”</span>}
            </span>
            {onShowEdge && r.type !== "gap" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowEdge(r.line);
                }}
                title="Show the evidence, with quotes"
                className="apple-press apple-focus flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--border-subtle)] px-1 py-px text-[9.5px] font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
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
      className={`rounded-lg border px-2.5 py-1.5 transition ${
        highlight
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent-border)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
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
    <Shell label={`${meta.label} link`} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="apple-press apple-focus flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </button>
        )}
        <Pill color={meta.color}>{meta.label}</Pill>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-[var(--text-secondary)]">
        {name(source, edge.source)}
        <span className="text-[11px]" style={{ color: meta.color }}>
          {edge.type === "supports" ? "and" : edge.type === "contradicts" ? "vs" : "leaves open"}
        </span>
        {name(target, edge.target)}
      </div>

      <div className="mt-3 space-y-2.5">
        {links.map(({ edge: e, from, to }, i) => (
          <div key={`${e.id}-${i}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5">
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
