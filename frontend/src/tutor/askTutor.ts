/**
 * "Ask a tutor about this": turn the paper or evidence map on screen into a Live Lesson track.
 *
 * The lesson backend builds a track's knowledge points from a material's nodes (id, label, summary) and
 * its prerequisite edges; everything else in a WorkspaceDataset is ignored. So before sending a topic:
 * - a Paper Simulator dataset (no graph nodes) gets nodes from its simulation docs (concepts, else the
 *   model, equations and parameters), so the tutor and the slide deck have something to teach from;
 * - an Evidence Map's supports / contradicts / open-question links are written into each node's summary,
 *   since the backend keeps only prerequisite edges.
 */
import type { GraphEdgeData, GraphNodeData, SimulationPayload, WorkspaceDataset } from "@/types/scholartwin";
import { addMaterial, createTrack, listTracks, type Material } from "./shell/api";

export type AskTutorTopic = {
  /** Shown as the lesson's topic, e.g. the paper title or the research question. */
  title: string;
  /** What the tutor should teach from. */
  dataset: WorkspaceDataset;
  /** Where it came from, if known (a PDF upload, an arXiv URL, a demo preset). */
  source?: { kind: "pdf" | "url" | "demo"; ref: string };
};

export const LESSON_ROUTE = "/lecture/lesson";
export const lessonHref = (trackId: string) => `${LESSON_ROUTE}?track=${encodeURIComponent(trackId)}`;

const MAX_SUMMARY = 700; // per knowledge point, so a big evidence map still makes a readable prompt

export const lessonTitle = (topic: AskTutorTopic) => topic.title.trim() || topic.dataset.title.trim() || "Untitled topic";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "topic";

/**
 * The material's kind and ref: the topic's own source when known, else "demo" with a stable ref built from
 * the mode and title (the ":" keeps it from ever matching one of the lesson module's own demo files).
 */
export function materialSource(topic: AskTutorTopic): { kind: Material["kind"]; ref: string } {
  const ref = topic.source?.ref.trim();
  if (topic.source && ref) return { kind: topic.source.kind, ref };
  return { kind: "demo", ref: `${topic.dataset.mode}:${slug(lessonTitle(topic))}` };
}

const clip = (s: string) => (s.length > MAX_SUMMARY ? `${s.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : s);
const join = (...parts: (string | undefined | null)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(" ");

function node(id: string, label: string, summary: string, category: GraphNodeData["category"] = "core"): GraphNodeData {
  return { id, label, category, summary, mastery: 0, x: 0, y: 0, quiz: [] };
}

const prereq = (source: string, target: string, i: number): GraphEdgeData => ({
  id: `kp-edge-${i}`,
  source,
  target,
  type: "prerequisite",
});

const VERB: Record<Exclude<GraphEdgeData["type"], "prerequisite">, string> = {
  supports: "Agrees with",
  contradicts: "Contradicts",
  gap: "Leaves open",
};

/** Writes each node's non-prerequisite links into its summary ("Contradicts “…” (only above 60 °C)."). */
function withRelations(nodes: GraphNodeData[], edges: GraphEdgeData[]): GraphNodeData[] {
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const notes = new Map<string, string[]>();
  for (const e of edges) {
    if (e.type === "prerequisite" || !label.has(e.source) || !label.has(e.target)) continue;
    const target = label.get(e.target)!;
    const condition = e.condition?.trim();
    // an open question's condition often just repeats its label
    const note = `${VERB[e.type]} “${target}”${condition && condition !== target.trim() ? ` (${condition})` : ""}.`;
    notes.set(e.source, [...(notes.get(e.source) ?? []), note]);
  }
  return nodes.map((n) => ({ ...n, summary: clip(join(n.summary, ...(notes.get(n.id) ?? []))), quiz: [] }));
}

/** Knowledge-point nodes for a simulation: its concept map when the docs have one, else model + equations + parameters. */
function simulationGraph(sim: SimulationPayload, title: string): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
  const docs = sim.docs;
  // one knowledge point per concept id (the backend prefixes ids per material, so they must be unique)
  const concepts = [...new Map((docs?.concepts ?? []).filter((c) => c.id && c.label).map((c) => [c.id, c])).values()];
  if (concepts.length) {
    const ids = new Set(concepts.map((c) => c.id));
    const links = (docs?.links ?? []).filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target);
    const nodes = concepts.map((c) => node(c.id, c.label, join(c.summary, c.detail)));
    const label = new Map(concepts.map((c) => [c.id, c.label]));
    const notes = new Map<string, string[]>();
    const edges: GraphEdgeData[] = [];
    links.forEach((l, i) => {
      if (!l.kind || l.kind === "prerequisite") edges.push(prereq(l.source, l.target, i));
      else notes.set(l.source, [...(notes.get(l.source) ?? []), `${l.relation || VERB[l.kind]} “${label.get(l.target)}”.`]);
    });
    return { nodes: nodes.map((n) => ({ ...n, summary: clip(join(n.summary, ...(notes.get(n.id) ?? []))) })), edges };
  }

  const model = node(
    "model",
    sim.sim_title || sim.paper_title || title,
    clip(join(docs?.overview || sim.summary, sim.equation_latex && `Key equation: ${sim.equation_latex}.`, ...(docs?.key_findings ?? [])))
  );
  const equations = (docs?.equations ?? []).map((e) => node(`eq-${e.id}`, e.title, clip(join(e.explanation, e.latex && `(${e.latex})`))));
  const params = sim.params.map((p) => {
    const doc = docs?.params?.find((d) => d.key === p.key);
    const range = `${p.min_val} to ${p.max_val}${p.unit ? ` ${p.unit}` : ""}`;
    return node(
      `param-${p.key}`,
      p.name || p.key,
      clip(doc ? join(doc.meaning, doc.effect, `Range in the simulation: ${range}.`) : `A simulation parameter, from ${range}.`)
    );
  });
  const rest = [...equations, ...params];
  return { nodes: [model, ...rest], edges: rest.map((n, i) => prereq(model.id, n.id, i)) };
}

/**
 * What to send as lesson material: just the graph (no simulation payload), with every node carrying a
 * teachable summary.
 */
export function lessonDataset(d: WorkspaceDataset, title = d.title): WorkspaceDataset {
  const base = { mode: d.mode, title: d.title || title, subtitle: d.subtitle ?? "", simulation: null };
  if (d.nodes.length) return { ...base, nodes: withRelations(d.nodes, d.edges), edges: d.edges };
  if (d.simulation) return { ...base, ...simulationGraph(d.simulation, title) };
  return { ...base, nodes: [], edges: [] };
}

/**
 * The track to teach this topic from: an existing one with the same title and material ref, else a fresh
 * track (or an empty one left by an earlier failed attempt) with the topic added as material.
 */
export async function openLessonTrack(topic: AskTutorTopic): Promise<string> {
  const title = lessonTitle(topic);
  const { kind, ref } = materialSource(topic);
  const sameTitle = (await listTracks()).filter((t) => t.title === title);
  const existing = sameTitle.find((t) => t.materials.some((m) => m.ref === ref));
  if (existing) return existing.track_id;
  const track = sameTitle.find((t) => t.materials.length === 0 && t.knowledge_points.length === 0) ?? (await createTrack(title));
  await addMaterial(track.track_id, { kind, ref, dataset: lessonDataset(topic.dataset, title) });
  return track.track_id;
}

/** A short, readable reason the lesson couldn't be set up (`status` comes from the shell API's errors). */
export function askTutorError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (!status) return "Couldn't reach the lesson service. Check the backend is running, then try again.";
  const text = e instanceof Error ? e.message : String(e);
  if (status >= 500) return "The lesson service hit an error while setting up this lesson. Try again in a moment.";
  // a plain-string detail is the backend's own reason; "HTTP 4xx" or a JSON validation list is not readable
  if (/^(HTTP \d|\[|\{)/.test(text)) return "The lesson service didn't accept this topic as lesson material.";
  return `Couldn't set up the lesson: ${text}`;
}
