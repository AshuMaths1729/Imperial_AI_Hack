/**
 * Builds the learner-facing concept graph for a PaperSim simulation.
 *
 * Preferred input is `simulation.docs` (concepts + links from the backend). When docs are absent
 * (older saved papers, offline demo) a graph is synthesised from the simulation spec itself, with
 * relation phrases derived from the data so the edges read as sentences.
 *
 * Guarantees for the layout: exactly one root (the paper), every node reachable from it, no
 * self-loops and at most one link per ordered pair.
 */
import type {
  ConceptDoc,
  ConceptKind,
  ConceptLink,
  ParamDoc,
  SimulationParam,
  SimulationPayload,
  SourceLoc,
} from "../../../types/scholartwin";

export type LinkKind = NonNullable<ConceptLink["kind"]>;

export interface CNode {
  id: string;
  label: string;
  kind: ConceptKind;
  summary: string;
  detail?: string;
  latex?: string;
  source?: SourceLoc | null;
  /** Slider key when this node is a simulation parameter. */
  paramKey?: string;
  param?: SimulationParam;
  paramDoc?: ParamDoc;
  isRoot: boolean;
}

export interface CLink {
  id: string;
  source: string;
  target: string;
  relation: string;
  explanation?: string;
  kind: LinkKind;
}

export interface ConceptGraph {
  rootId: string;
  nodes: CNode[];
  links: CLink[];
  /** True when the graph came from backend docs rather than the local fallback. */
  fromDocs: boolean;
}

const KINDS: ConceptKind[] = [
  "paper",
  "model",
  "concept",
  "variable",
  "parameter",
  "assumption",
  "result",
  "cited_work",
];

function normKind(kind: string | undefined): ConceptKind {
  return (KINDS as string[]).includes(kind ?? "") ? (kind as ConceptKind) : "concept";
}

function clean(s: string | undefined | null): string {
  return (s ?? "").trim();
}

/** Relation used when we must attach an otherwise unreachable node to the paper. */
const ROOT_RELATION: Record<ConceptKind, { relation: string; kind: LinkKind; why: string }> = {
  paper: { relation: "relates to", kind: "supports", why: "Both works are discussed together." },
  model: { relation: "proposes", kind: "prerequisite", why: "The paper introduces this model." },
  concept: { relation: "relies on", kind: "prerequisite", why: "You need this idea to follow the paper." },
  variable: { relation: "tracks", kind: "prerequisite", why: "The paper measures or predicts this quantity." },
  parameter: { relation: "is tuned by", kind: "prerequisite", why: "This knob controls the paper's model." },
  assumption: { relation: "assumes", kind: "gap", why: "The results only hold if this simplification is true." },
  result: { relation: "reports", kind: "supports", why: "This is one of the paper's findings." },
  cited_work: { relation: "builds on", kind: "supports", why: "The paper cites and extends this earlier work." },
};

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(Number(v.toPrecision(4)));
}

export function formatParamValue(v: number, unit?: string): string {
  const u = clean(unit);
  return u ? `${formatNum(v)} ${u}` : formatNum(v);
}

/** Verb phrase for "model -> parameter", derived from the parameter's name / unit. */
function paramRelation(p: SimulationParam): string {
  const n = `${p.name} ${p.key}`.toLowerCase();
  if (/initial|start|_0\b|0$|init/.test(n)) return "starts from";
  if (/rate|speed|velocity|frequency/.test(n)) return "changes at a pace set by";
  if (/interval|period|time|delay|duration|spacing/.test(n)) return "is timed by";
  if (/threshold|cutoff|critical/.test(n)) return "switches behaviour at";
  if (/damp|friction|decay|loss|drag/.test(n)) return "is slowed down by";
  if (/gain|strength|weight|coupling|coefficient|scale|factor|amplitude/.test(n)) return "is scaled by";
  if (/count|number|size|population|\bn\b/.test(n)) return "is sized by";
  if (/prob|chance|fraction|ratio/.test(n)) return "is weighted by";
  return "is tuned by";
}

function paramExplanation(p: SimulationParam): string {
  return `Move the “${p.name}” slider between ${formatParamValue(p.min_val, p.unit)} and ${formatParamValue(
    p.max_val,
    p.unit
  )} and watch the curves respond.`;
}

/** Graph synthesised from the bare simulation spec (no docs). */
function fallbackGraph(sim: SimulationPayload): ConceptGraph {
  const nodes: CNode[] = [];
  const links: CLink[] = [];
  const paperTitle = clean(sim.paper_title) || "Source paper";
  const simTitle = clean(sim.sim_title);
  const distinctModel = simTitle && simTitle !== paperTitle;

  nodes.push({
    id: "paper",
    label: paperTitle,
    kind: "paper",
    summary: clean(sim.summary) || "The paper this simulation was extracted from.",
    isRoot: true,
  });
  nodes.push({
    id: "model",
    label: distinctModel ? simTitle : "Simulated model",
    kind: "model",
    summary: distinctModel
      ? `The mathematical model behind the simulation: ${simTitle}.`
      : "The mathematical model extracted from the paper and turned into a runnable simulation.",
    detail: "Every curve in the simulation tab comes from solving this model with the current slider values.",
    latex: clean(sim.equation_latex) || undefined,
    isRoot: false,
  });
  links.push({
    id: "l-paper-model",
    source: "paper",
    target: "model",
    relation: distinctModel ? "formalises its idea as" : "is captured by",
    explanation: "The paper's central idea, written as equations you can run.",
    kind: "prerequisite",
  });

  const xLabel = clean(sim.x_label);
  if (xLabel) {
    nodes.push({
      id: "var-x",
      label: xLabel,
      kind: "variable",
      summary: `The independent variable: everything in the model is computed as ${xLabel} advances.`,
      isRoot: false,
    });
    links.push({
      id: "l-model-x",
      source: "model",
      target: "var-x",
      relation: "evolves along",
      explanation: `The horizontal axis of the plots is ${xLabel}.`,
      kind: "prerequisite",
    });
  }

  sim.params.forEach((p) => {
    const id = `param-${p.key}`;
    nodes.push({
      id,
      label: p.name || p.key,
      kind: "parameter",
      summary: `A tunable input of the model, ranging from ${formatParamValue(p.min_val, p.unit)} to ${formatParamValue(
        p.max_val,
        p.unit
      )}.`,
      detail: "Change it in the simulation and the predicted curves shift with it.",
      paramKey: p.key,
      param: p,
      isRoot: false,
    });
    links.push({
      id: `l-model-${id}`,
      source: "model",
      target: id,
      relation: paramRelation(p),
      explanation: paramExplanation(p),
      kind: "prerequisite",
    });
  });

  const yLabel = clean(sim.y_label);
  sim.series.forEach((s, idx) => {
    const id = `result-${idx}`;
    nodes.push({
      id,
      label: s.name,
      kind: "result",
      summary: `A curve the simulation outputs${yLabel ? `, measured as ${yLabel}` : ""}${
        xLabel ? ` over ${xLabel}` : ""
      }.`,
      isRoot: false,
    });
    links.push({
      id: `l-model-${id}`,
      source: "model",
      target: id,
      relation: idx === 0 ? "predicts" : "also outputs",
      explanation: `Plotted as “${s.name}” in the simulation (${s.y.length} samples).`,
      kind: "supports",
    });
  });

  (sim.assumptions ?? []).forEach((a, idx) => {
    const text = clean(a);
    if (!text) return;
    const id = `assumption-${idx}`;
    const short = text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
    nodes.push({
      id,
      label: short,
      kind: "assumption",
      summary: text,
      detail: "Simplifications like this keep the model tractable, but the results only hold while it is true.",
      isRoot: false,
    });
    links.push({
      id: `l-model-${id}`,
      source: "model",
      target: id,
      relation: "assumes",
      explanation: "If this simplification breaks, the predictions may not either.",
      kind: "gap",
    });
  });

  return { rootId: "paper", nodes, links, fromDocs: false };
}

function fromConcept(c: ConceptDoc, sim: SimulationPayload, paramDocs: Map<string, ParamDoc>): CNode {
  const paramKey = clean(c.param_key ?? undefined) || undefined;
  return {
    id: c.id,
    label: clean(c.label) || c.id,
    kind: normKind(c.kind),
    summary: clean(c.summary),
    detail: clean(c.detail) || undefined,
    latex: clean(c.latex) || undefined,
    source: c.source ?? null,
    paramKey,
    param: paramKey ? sim.params.find((p) => p.key === paramKey) : undefined,
    paramDoc: paramKey ? paramDocs.get(paramKey) : undefined,
    isRoot: false,
  };
}

export function buildConceptGraph(sim: SimulationPayload): ConceptGraph {
  const docs = sim.docs;
  const concepts = docs?.concepts ?? [];
  if (!docs || concepts.length === 0) return attachParamDocs(fallbackGraph(sim), sim);

  const paramDocs = new Map<string, ParamDoc>((docs.params ?? []).map((p) => [p.key, p]));
  const byId = new Map<string, CNode>();
  for (const c of concepts) {
    if (!c?.id || byId.has(c.id)) continue;
    byId.set(c.id, fromConcept(c, sim, paramDocs));
  }

  // Root: explicit "paper" id, else the first paper-kind concept, else synthesise one.
  let root = byId.get("paper") ?? Array.from(byId.values()).find((n) => n.kind === "paper");
  if (!root) {
    root = {
      id: "paper",
      label: clean(sim.paper_title) || "Source paper",
      kind: "paper",
      summary: clean(docs.overview) || clean(sim.summary),
      isRoot: true,
    };
    byId.set(root.id, root);
  }
  root.isRoot = true;
  if (!root.summary) root.summary = clean(docs.overview) || clean(sim.summary);
  const rootId = root.id;

  // Every slider must appear as a parameter node.
  const coveredKeys = new Set(
    Array.from(byId.values())
      .map((n) => n.paramKey)
      .filter(Boolean) as string[]
  );
  const modelNode = Array.from(byId.values()).find((n) => n.kind === "model");
  const extraLinks: CLink[] = [];
  for (const p of sim.params) {
    if (coveredKeys.has(p.key)) continue;
    const pd = paramDocs.get(p.key);
    const id = `param-${p.key}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      label: p.name || p.key,
      kind: "parameter",
      summary: clean(pd?.meaning) || `A tunable input of the model (${formatParamValue(p.min_val, p.unit)} – ${formatParamValue(p.max_val, p.unit)}).`,
      detail: clean(pd?.effect) || undefined,
      latex: clean(pd?.symbol_latex) || undefined,
      source: pd?.source ?? null,
      paramKey: p.key,
      param: p,
      paramDoc: pd,
      isRoot: false,
    });
    extraLinks.push({
      id: `l-auto-${id}`,
      source: modelNode?.id ?? rootId,
      target: id,
      relation: paramRelation(p),
      explanation: clean(pd?.effect) || paramExplanation(p),
      kind: "prerequisite",
    });
  }

  // Links: drop dangling / self / duplicate pairs.
  const seen = new Set<string>();
  const links: CLink[] = [];
  const pushLink = (l: CLink) => {
    if (!byId.has(l.source) || !byId.has(l.target) || l.source === l.target) return;
    const pair = `${l.source}\u0000${l.target}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    links.push(l);
  };
  (docs.links ?? []).forEach((l, i) =>
    pushLink({
      id: `l-${i}-${l.source}-${l.target}`,
      source: l.source,
      target: l.target,
      relation: clean(l.relation) || ROOT_RELATION[byId.get(l.target)?.kind ?? "concept"].relation,
      explanation: clean(l.explanation) || undefined,
      kind: l.kind ?? "prerequisite",
    })
  );
  extraLinks.forEach(pushLink);

  // Make every node reachable from the root (attach unreachable "tops" to the paper).
  const out = new Map<string, string[]>();
  for (const l of links) out.set(l.source, [...(out.get(l.source) ?? []), l.target]);
  const reach = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const nxt of out.get(cur) ?? []) {
      if (!reach.has(nxt)) {
        reach.add(nxt);
        queue.push(nxt);
      }
    }
  }
  const incoming = new Set(links.map((l) => l.target));
  const unreachable = Array.from(byId.values()).filter((n) => !reach.has(n.id));
  // Prefer attaching nodes with no incoming link; their descendants then become reachable too.
  const ordered = [...unreachable.filter((n) => !incoming.has(n.id)), ...unreachable.filter((n) => incoming.has(n.id))];
  for (const n of ordered) {
    if (reach.has(n.id)) continue;
    const spec = ROOT_RELATION[n.kind];
    pushLink({
      id: `l-root-${n.id}`,
      source: rootId,
      target: n.id,
      relation: spec.relation,
      explanation: spec.why,
      kind: spec.kind,
    });
    const stack = [n.id];
    reach.add(n.id);
    while (stack.length) {
      const cur = stack.pop() as string;
      for (const nxt of out.get(cur) ?? []) {
        if (!reach.has(nxt)) {
          reach.add(nxt);
          stack.push(nxt);
        }
      }
    }
  }

  // Root first so it is the default selection and ranks first.
  const nodes = [root, ...Array.from(byId.values()).filter((n) => n.id !== rootId)];
  return { rootId, nodes, links, fromDocs: true };
}

/** In the fallback graph, enrich parameter nodes with any ParamDoc that exists. */
function attachParamDocs(g: ConceptGraph, sim: SimulationPayload): ConceptGraph {
  const pds = sim.docs?.params ?? [];
  if (pds.length === 0) return g;
  const map = new Map(pds.map((p) => [p.key, p]));
  for (const n of g.nodes) {
    if (!n.paramKey) continue;
    const pd = map.get(n.paramKey);
    if (!pd) continue;
    n.paramDoc = pd;
    n.summary = clean(pd.meaning) || n.summary;
    n.detail = clean(pd.effect) || n.detail;
    n.latex = clean(pd.symbol_latex) || n.latex;
    n.source = pd.source ?? n.source;
  }
  return g;
}

/** Symbol (LaTeX) to show for a parameter node. */
export function paramSymbol(n: CNode): string | undefined {
  return clean(n.paramDoc?.symbol_latex) || (n.kind === "parameter" ? n.latex : undefined);
}

/** Merged source location (concept source, else its ParamDoc's). */
export function sourceOf(n: CNode): SourceLoc | null {
  const s = n.source;
  if (s && (s.page != null || clean(s.section) || clean(s.quote))) return s;
  const p = n.paramDoc?.source;
  if (p && (p.page != null || clean(p.section) || clean(p.quote))) return p;
  return null;
}

/** Shortest directed path root -> id (node ids, inclusive), falling back to undirected. */
export function pathFromRoot(g: ConceptGraph, id: string): string[] {
  if (id === g.rootId) return [id];
  const search = (directed: boolean): string[] | null => {
    const adj = new Map<string, string[]>();
    const add = (a: string, b: string) => adj.set(a, [...(adj.get(a) ?? []), b]);
    for (const l of g.links) {
      add(l.source, l.target);
      if (!directed) add(l.target, l.source);
    }
    const prev = new Map<string, string>();
    const q = [g.rootId];
    const seen = new Set(q);
    while (q.length) {
      const cur = q.shift() as string;
      if (cur === id) break;
      for (const nxt of adj.get(cur) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        prev.set(nxt, cur);
        q.push(nxt);
      }
    }
    if (!seen.has(id)) return null;
    const path = [id];
    while (path[0] !== g.rootId) path.unshift(prev.get(path[0]) as string);
    return path;
  };
  return search(true) ?? search(false) ?? [id];
}

/** Link between two adjacent nodes in either direction. */
export function linkBetween(g: ConceptGraph, a: string, b: string): CLink | undefined {
  return g.links.find((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a));
}
