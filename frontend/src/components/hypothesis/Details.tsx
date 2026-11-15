"use client";

import React from "react";
import { ArrowLeft, ArrowRight, BookOpen, CircleDashed, ExternalLink, FileText, MousePointerClick, Quote, X } from "lucide-react";
import type { GraphEdgeData, GraphNodeData } from "../../types/scholartwin";
import { resolveCitationUrl } from "../../api/citations";
import { EDGE_PALETTE, EdgeSwatch } from "../GraphCanvas";
import { connectionsOf, type HypothesisModel, type NodeKind } from "./model";
import { scrollIntoBox } from "./scroll";

/**
 * What the Evidence Map says about the thing you picked: a paper, an open question or a line.
 *
 * - `panel`: the top of the side panel on wide screens, above the list of all papers.
 * - `bubble`: a glass bubble docked to the bottom of the map on narrower screens, where the
 *   side panel stacks below the map (the zoom controls sit top-left, so it never covers them).
 *
 * The `header` (tag, title, citation, list label) stays put; only the list below it scrolls.
 */
export type DetailVariant = "panel" | "bubble";

const KIND_META: Record<NodeKind, { label: string; color: string; icon: typeof BookOpen }> = {
  paper: { label: "Paper", color: "var(--accent)", icon: BookOpen },
  claim: { label: "Claim", color: "var(--text-secondary)", icon: FileText },
  gap: { label: "Open question", color: "var(--status-gap)", icon: CircleDashed },
};

/** Link to the paper (arXiv / DOI / OpenAlex …, else a Scholar search). */
export function paperUrl(paper: GraphNodeData): string | undefined {
  return resolveCitationUrl({ docId: paper.doc_id || paper.id, citation: paper.authors_year, title: paper.label });
}

/** A claim's summary is usually `"quote" [condition: …]`: split it so each reads on its own. */
function splitQuote(summary: string | undefined, label: string): { quote?: string; condition?: string; text?: string } {
  const s = summary?.trim();
  if (!s || s === label) return {};
  const m = /^["“]([\s\S]+?)["”]\s*(?:\[condition:\s*([\s\S]+?)\])?\s*$/.exec(s);
  if (m) return { quote: m[1].trim(), condition: m[2]?.trim() };
  return { text: s };
}

function Frame({
  variant,
  label,
  onClose,
  header,
  children,
}: {
  variant: DetailVariant;
  label: string;
  onClose?: () => void;
  header: React.ReactNode;
  children?: React.ReactNode;
}) {
  const close = onClose && (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close details"
      title="Close (Esc)"
      className="apple-press apple-focus absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
  const body = children && (
    // The only scroller. Margins (not padding) so the scrollbar stops short of the rim; the inner
    // padding keeps the cards' borders and focus rings inside the clip box.
    <div data-detail-scroll className="mx-3 mb-3 min-h-0 flex-1 overflow-y-auto">
      <div className="p-1">{children}</div>
    </div>
  );

  if (variant === "bubble") {
    // The bubble is short, so its header scrolls with the list (a fixed header would leave the
    // list a sliver). The close button stays pinned in the corner.
    return (
      <div
        role="dialog"
        aria-label={label}
        className="apple-glass-elevated apple-materialize absolute bottom-3 left-3 right-3 z-20 mx-auto flex max-h-[max(56%,15rem)] max-w-xl flex-col overflow-hidden rounded-[24px] border"
      >
        {close}
        <div data-detail-scroll className="my-1 mr-1 min-h-0 flex-1 overflow-y-auto">
          <div className={`px-3 pr-11 pt-3 ${children ? "pb-1" : "pb-3"}`}>{header}</div>
          {children && <div className="px-2 pb-2">{children}</div>}
        </div>
      </div>
    );
  }
  return (
    <section aria-label={label} className="st-fade-up relative flex min-h-0 flex-1 flex-col">
      {close}
      <div className={`shrink-0 px-4 pt-4 ${onClose ? "pr-12" : ""} ${children ? "pb-1" : "pb-4"}`}>{header}</div>
      {body}
    </section>
  );
}

/** The type tag at the top of the details ("Paper", "Contradicts" …). */
function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        color: `color-mix(in srgb, ${color} 88%, var(--text-primary))`,
        borderColor: `color-mix(in srgb, ${color} 34%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 11%, transparent)`,
      }}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium leading-none"
    >
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">{children}</p>
  );
}

/** A quote from the paper, with a coloured rim (and the condition it holds under, if any). */
function Excerpt({ quote, condition, color, by }: { quote: string; condition?: string; color: string; by?: string }) {
  return (
    <blockquote
      style={{ borderLeftColor: color }}
      className="mt-1.5 border-l-[3px] pl-2.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)]"
    >
      <span className="italic">“{quote}”</span>
      {by && <span className="text-[var(--text-muted)]"> · {by}</span>}
      {condition && (
        <span className="mt-0.5 block text-[11px] not-italic text-[var(--text-muted)]">
          <span className="font-semibold">When:</span> {condition}
        </span>
      )}
    </blockquote>
  );
}

/** Authors / year, where it was published, and a button that opens the paper. */
function Citation({ paper }: { paper: GraphNodeData }) {
  const url = paperUrl(paper);
  const venue = paper.summary && paper.summary !== paper.label ? paper.summary : null;
  const ink = "color-mix(in srgb, var(--accent) 82%, var(--text-primary))";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {paper.authors_year && (
        <span className="text-[12px] font-semibold" style={{ color: ink }}>
          {paper.authors_year}
        </span>
      )}
      {venue && <span className="text-[11.5px] text-[var(--text-muted)]">{venue}</span>}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: ink }}
          className="apple-press apple-focus inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold leading-none hover:border-[var(--accent)]"
        >
          Open paper
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/** Nothing picked yet: the question itself, and how to read the map. */
export function QuestionDetails({ title }: { title: string }) {
  return (
    <Frame
      variant="panel"
      label="Your question"
      header={
        <>
          <Tag color="var(--status-gap)">Your question</Tag>
          <h3 className="apple-heading mt-2.5 break-words text-[17px] font-medium leading-snug text-[var(--text-primary)]">
            {title}
          </h3>
          <p className="mt-2 flex gap-2 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-gap)]" aria-hidden />
            <span>
              Pick a paper on the map to see what it claims, who agrees or disagrees, and the quotes that show it. Click a
              line to see why two papers are linked.
            </span>
          </p>
        </>
      }
    />
  );
}

/** Details for a clicked paper or open question. */
export function NodeDetails({
  variant,
  model,
  node,
  onSelectNode,
  onShowEdge,
  onClose,
  highlightClaimId,
}: {
  variant: DetailVariant;
  model: HypothesisModel;
  node: GraphNodeData;
  onSelectNode: (id: string) => void;
  onShowEdge: (edge: GraphEdgeData) => void;
  onClose: () => void;
  /** A claim picked in the list: it's marked and scrolled into view. */
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
          className="apple-press apple-focus flex min-w-0 flex-1 items-baseline gap-2 rounded-xl px-2 py-1.5 text-left leading-snug hover:bg-[var(--bg-surface-muted)]"
        >
          <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: `color-mix(in srgb, ${l.color} 84%, var(--text-primary))` }}>
            <EdgeSwatch type={l.edge.type} width={12} />
            {l.verb}
          </span>
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text-primary)]">
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
        {why.length > 0 && <WhyButton onClick={() => onShowEdge(l.edge)} title="Show which claims, with quotes" />}
      </li>
    );
  };

  // With claims listed, their links already say who agrees / disagrees; otherwise list the
  // linked papers, then the open questions. A paper keeps its one list label in the fixed
  // header (so the scroll box holds just the rows); an open question's description and labels
  // scroll with its list, so a long description can't crowd the list out.
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
    <Frame
      variant={variant}
      label={`${meta.label} details`}
      onClose={onClose}
      header={
        <>
          <Tag color={meta.color}>
            <KindIcon className="h-3 w-3" />
            {meta.label}
          </Tag>
          <h3 className="apple-heading mt-2.5 break-words text-[15px] font-semibold leading-snug text-[var(--text-primary)]">
            {node.label}
          </h3>
          {kind === "paper" && <Citation paper={node} />}
          {headerLabel && (
            <div className="mt-3.5 -mb-1.5">
              <Label>{headerLabel}</Label>
            </div>
          )}
        </>
      }
    >
      {hasBody && (
        <>
          {summary && <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">{summary}</p>}

          {claims.length > 0 && (
            <ul className="space-y-2">
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
              <ul className="space-y-0.5">{papersLinked.map(row)}</ul>
            </div>
          )}

          {showGaps && (
            <div className={showLinked ? "mt-3" : ""}>
              {inlineLabels && <Label>{gapsLabel}</Label>}
              <ul className="space-y-0.5">{gapsLeft.map(row)}</ul>
            </div>
          )}

          {standsAlone && (
            <p className="rounded-2xl border border-dashed border-[var(--border-strong)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Stands alone.</span> No other paper in this search
              agrees or disagrees with it, and it raises no open question, so it&apos;s greyed out on the map.
            </p>
          )}
        </>
      )}
    </Frame>
  );
}

function WhyButton({ onClick, title, small }: { onClick: (e: React.MouseEvent) => void; title: string; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`apple-press apple-focus mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] font-semibold text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] ${
        small ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[10.5px]"
      }`}
    >
      <Quote className="h-2.5 w-2.5" />
      Why
    </button>
  );
}

const CLAIM_VERB: Record<GraphEdgeData["type"], string> = {
  supports: "Agrees with",
  contradicts: "Contradicts",
  gap: "Leaves open",
  prerequisite: "Leads to",
};

/** Short "what it links to" lines for one claim. */
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
    return <p className="mt-1 text-[11px] italic text-[var(--text-muted)]">Not linked to another paper or open question</p>;
  }
  return (
    <ul className="mt-1.5 space-y-1">
      {rels.map((r, i) => {
        const color = EDGE_PALETTE[r.type].color;
        const target = r.type === "gap" ? r.other.label : r.other.authors_year || r.other.label;
        return (
          <li key={`${r.line.id}-${i}`} className="flex items-start gap-2 text-[11px] leading-[1.5]">
            {/* One line of text: swatch, verb and target all share the first line's baseline.
                (A block-level clamp inside the target button used to drop the verb onto the
                button's last line, so the three sat at different heights.) The clamp applies
                to the whole line instead. */}
            <p className={`min-w-0 flex-1 ${r.type === "gap" ? "line-clamp-3" : ""}`}>
              <span aria-hidden className="mr-1.5 inline-block align-middle">
                <EdgeSwatch type={r.type} width={12} />
              </span>
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
              <WhyButton
                small
                title="Show the evidence, with quotes"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowEdge(r.line);
                }}
              />
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
    if (highlight) scrollIntoBox(ref.current?.closest<HTMLElement>("[data-detail-scroll]"), ref.current);
  }, [highlight]);
  const said = splitQuote(claim.summary, claim.label);
  return (
    <li
      ref={ref}
      className={`rounded-2xl border px-3 py-2 transition ${
        highlight
          ? "border-[var(--accent-border)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent-border)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface-muted)]"
      }`}
    >
      <p className="text-[12px] font-medium leading-snug text-[var(--text-primary)]">{claim.label}</p>
      {said.quote && <Excerpt quote={said.quote} condition={said.condition} color="var(--border-strong)" />}
      {said.text && <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{said.text}</p>}
      <ClaimLinks model={model} claimId={claim.id} onSelectNode={onSelectNode} onShowEdge={onShowEdge} />
    </li>
  );
}

/** Details for a clicked line: the claims behind it, with quotes. */
export function EdgeDetails({
  variant,
  model,
  edge,
  onSelectNode,
  onBack,
  onClose,
}: {
  variant: DetailVariant;
  model: HypothesisModel;
  edge: GraphEdgeData;
  onSelectNode: (id: string) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const meta = EDGE_PALETTE[edge.type];
  const ink = `color-mix(in srgb, ${meta.color} 84%, var(--text-primary))`;
  const source = model.byId.get(edge.source);
  const target = model.byId.get(edge.target);
  const links = model.linksOf.get(edge.id) ?? [];
  const name = (n: GraphNodeData | undefined, id: string) => (
    <button
      type="button"
      onClick={() => onSelectNode(id)}
      className="apple-press apple-focus min-w-0 rounded-lg px-1.5 py-0.5 text-left text-[12.5px] font-semibold text-[var(--text-primary)] underline decoration-[var(--border-strong)] underline-offset-2 hover:bg-[var(--bg-surface-muted)]"
    >
      {n ? (model.kind(n.id) === "paper" && n.authors_year) || n.label : id}
    </button>
  );
  const author = (claim: GraphNodeData) => model.byId.get(model.resolveId(claim.id) ?? "")?.authors_year;

  return (
    <Frame
      variant={variant}
      label={`${meta.label} link`}
      onClose={onClose}
      header={
        <>
          <div className="flex flex-wrap items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="apple-press apple-focus flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] px-2.5 py-1 text-[11px] font-medium leading-none text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
            )}
            <Tag color={meta.color}>
              <EdgeSwatch type={edge.type} width={14} />
              {meta.label}
            </Tag>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1 pb-1.5 text-[12px] text-[var(--text-secondary)]">
            {name(source, edge.source)}
            <span className="text-[11.5px] font-medium" style={{ color: ink }}>
              {edge.type === "supports" ? "and" : edge.type === "contradicts" ? "vs" : edge.type === "gap" ? "leaves open" : "leads to"}
            </span>
            {name(target, edge.target)}
          </div>
        </>
      }
    >
      <div className="space-y-2.5">
        {links.map(({ edge: e, from, to }, i) => (
          <div key={`${e.id}-${i}`} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
            <p className="text-[12px] leading-snug text-[var(--text-primary)]">
              {author(from) && <span className="font-semibold">{author(from)}: </span>}
              {from.label}
            </p>
            <p className="my-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: ink }}>
              <ArrowRight className="h-3 w-3" />
              {e.type === "supports" ? "agrees with" : e.type === "contradicts" ? "contradicts" : e.type === "gap" ? "leaves open" : "leads to"}
            </p>
            <p className="text-[12px] leading-snug text-[var(--text-primary)]">
              {model.kind(model.resolveId(to.id) ?? "") !== "gap" && author(to) && (
                <span className="font-semibold">{author(to)}: </span>
              )}
              {to.label.replace(/^untested\s*:\s*/i, "")}
            </p>
            {(e.label || e.condition) && (
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)]">{e.label || e.condition}</p>
            )}
            {e.evidence?.map((ev, j) => (
              <Excerpt key={`${ev.paper_id}-${j}`} quote={ev.quote} color={meta.color} by={model.byId.get(ev.paper_id)?.authors_year} />
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}
