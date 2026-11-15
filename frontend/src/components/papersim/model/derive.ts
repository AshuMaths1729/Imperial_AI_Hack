/** Data shaping for the Model & Equations tab, with graceful fallbacks when docs are absent. */
import type {
  EquationDoc,
  EquationVar,
  ParamDoc,
  SimulationParam,
  SimulationPayload,
  SourceLoc,
} from "../../../types/scholartwin";

export interface SourceRef {
  kind: "Equation" | "Parameter" | "Concept";
  label: string;
  latex?: string;
  section?: string;
  quote?: string;
  /** In-page anchor to jump to, when the item is rendered in this tab. */
  anchor?: string;
}

export interface SourceGroup {
  page: number | null;
  items: SourceRef[];
}

const hasLoc = (s?: SourceLoc | null): s is SourceLoc => !!s && (s.page != null || !!s.section || !!s.quote);

export function eqAnchor(id: string, i: number) {
  return `model-eq-${(id || String(i)).replace(/[^\w-]/g, "_")}`;
}
export function paramAnchor(key: string) {
  return `model-param-${key.replace(/[^\w-]/g, "_")}`;
}

/** Every page reference in the docs, grouped by page (unpaged last). */
export function collectSources(sim: SimulationPayload): SourceGroup[] {
  const docs = sim.docs;
  if (!docs) return [];
  const refs: { page: number | null; ref: SourceRef }[] = [];
  (docs.equations ?? []).forEach((e, i) => {
    if (hasLoc(e.source))
      refs.push({
        page: e.source.page ?? null,
        ref: {
          kind: "Equation",
          label: e.title || `Equation ${i + 1}`,
          latex: e.latex,
          section: e.source.section,
          quote: e.source.quote,
          anchor: eqAnchor(e.id, i),
        },
      });
  });
  (docs.params ?? []).forEach((p) => {
    if (hasLoc(p.source)) {
      const name = sim.params.find((sp) => sp.key === p.key)?.name ?? p.key;
      refs.push({
        page: p.source.page ?? null,
        ref: {
          kind: "Parameter",
          label: name,
          latex: p.symbol_latex,
          section: p.source.section,
          quote: p.source.quote,
          anchor: paramAnchor(p.key),
        },
      });
    }
  });
  (docs.concepts ?? []).forEach((c) => {
    if (hasLoc(c.source))
      refs.push({
        page: c.source.page ?? null,
        ref: { kind: "Concept", label: c.label, latex: c.latex, section: c.source.section, quote: c.source.quote },
      });
  });
  const map = new Map<string, SourceGroup>();
  for (const { page, ref } of refs) {
    const k = page == null ? "none" : String(page);
    const g = map.get(k) ?? { page, items: [] };
    g.items.push(ref);
    map.set(k, g);
  }
  return [...map.values()].sort((a, b) =>
    a.page == null ? 1 : b.page == null ? -1 : a.page - b.page,
  );
}

const normSym = (s: string) => s.replace(/\s+/g, "").replace(/^\$+|\$+$/g, "");

/** docs.glossary, else symbols gathered from equation variables and parameter docs. */
export function glossaryOf(sim: SimulationPayload): { items: EquationVar[]; derived: boolean } {
  const g = sim.docs?.glossary ?? [];
  if (g.length) return { items: g, derived: false };
  const seen = new Set<string>();
  const items: EquationVar[] = [];
  const push = (v: EquationVar) => {
    const k = normSym(v.symbol_latex);
    if (!k || seen.has(k) || !v.meaning) return;
    seen.add(k);
    items.push(v);
  };
  for (const e of sim.docs?.equations ?? []) for (const v of e.variables ?? []) push(v);
  for (const p of sim.docs?.params ?? []) if (p.symbol_latex) push({ symbol_latex: p.symbol_latex, meaning: p.meaning });
  return { items, derived: true };
}

/** Equations from docs, else the single governing equation. */
export function equationsOf(sim: SimulationPayload): { items: EquationDoc[]; derived: boolean } {
  const eqs = (sim.docs?.equations ?? []).filter((e) => e.latex?.trim());
  if (eqs.length) return { items: eqs, derived: false };
  if (sim.equation_latex?.trim())
    return {
      items: [{ id: "governing", title: "Governing equation", latex: sim.equation_latex, explanation: "" }],
      derived: true,
    };
  return { items: [], derived: true };
}

export interface ParamRow {
  p: SimulationParam;
  doc?: ParamDoc;
}

export function paramRows(sim: SimulationPayload): ParamRow[] {
  const docs = new Map((sim.docs?.params ?? []).map((d) => [d.key, d]));
  return sim.params.map((p) => ({ p, doc: docs.get(p.key) }));
}

/** "§3.2 · p.4" style label. */
export function locLabel(s?: SourceLoc | null): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.section) parts.push(/^\d/.test(s.section) ? `§${s.section}` : s.section);
  if (s.page != null) parts.push(`p.${s.page}`);
  return parts.join(" · ");
}
