import type { SimulationPayload } from "../../types/scholartwin";
import { prettyMath } from "../math/autoMath";

/**
 * Make short, plain-text labels math-friendly before any tab renders them.
 *
 * Labels (slider names, series names, axis titles, concept labels, relation phrases, preset
 * and equation titles) are also shown where HTML/KaTeX cannot go: `<option>`, SVG `<text>`,
 * `title` tooltips, CSV headers. So they are converted to Unicode math here ("S_0" -> "S₀",
 * "$\Delta S$" -> "ΔS"). Prose fields are left untouched: they render through `RichText`,
 * which typesets both `$..$` and undelimited math. Applied to series AND docs.series names
 * alike, so name matching between them keeps working. Idempotent.
 */
export function normalizeSimulation(sim: SimulationPayload): SimulationPayload {
  const p = prettyMath;
  const docs = sim.docs;
  return {
    ...sim,
    paper_title: p(sim.paper_title),
    sim_title: sim.sim_title ? p(sim.sim_title) : sim.sim_title,
    x_label: p(sim.x_label),
    y_label: p(sim.y_label),
    params: sim.params.map((q) => ({ ...q, name: p(q.name), unit: p(q.unit) })),
    series: sim.series.map((s) => ({ ...s, name: p(s.name) })),
    docs: docs && {
      ...docs,
      concepts: docs.concepts?.map((c) => ({ ...c, label: p(c.label) })),
      links: docs.links?.map((l) => ({ ...l, relation: p(l.relation) })),
      series: docs.series?.map((s) => ({ ...s, name: p(s.name) })),
      presets: docs.presets?.map((pr) => ({ ...pr, name: p(pr.name) })),
      equations: docs.equations?.map((e) => ({ ...e, title: p(e.title) })),
      derivation: docs.derivation?.map((d) => ({ ...d, title: p(d.title) })),
    },
  };
}
