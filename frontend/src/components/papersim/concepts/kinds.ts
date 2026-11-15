import {
  FileText,
  Library,
  Lightbulb,
  ShieldQuestionMark,
  Sigma,
  SlidersHorizontal,
  TrendingUp,
  Variable,
  type LucideIcon,
} from "lucide-react";
import type { ConceptKind } from "../../../types/scholartwin";
import type { LinkKind } from "./model";

/** Theme-token mixes: every colour derives from the design-system variables. */
export const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

export interface KindMeta {
  label: string;
  /** Plural, for the legend / filters. */
  plural: string;
  icon: LucideIcon;
  color: string;
  /** One-line explanation for learners (legend tooltip). */
  blurb: string;
}

export const KIND_META: Record<ConceptKind, KindMeta> = {
  paper: {
    label: "Paper",
    plural: "Paper",
    icon: FileText,
    color: "var(--accent)",
    blurb: "The source paper: everything else hangs off it.",
  },
  model: {
    label: "Model",
    plural: "Models",
    icon: Sigma,
    color: "color-mix(in srgb, var(--accent) 55%, var(--status-gap))",
    blurb: "The mathematical model the simulation runs.",
  },
  concept: {
    label: "Concept",
    plural: "Concepts",
    icon: Lightbulb,
    color: "var(--status-gap)",
    blurb: "An idea you need to follow the paper.",
  },
  variable: {
    label: "Variable",
    plural: "Variables",
    icon: Variable,
    color: "color-mix(in srgb, var(--accent) 45%, var(--status-support))",
    blurb: "A quantity the model tracks as it runs.",
  },
  parameter: {
    label: "Parameter",
    plural: "Parameters",
    icon: SlidersHorizontal,
    color: "var(--status-warning)",
    blurb: "A knob you can turn in the simulation.",
  },
  assumption: {
    label: "Assumption",
    plural: "Assumptions",
    icon: ShieldQuestionMark,
    color: "var(--text-muted)",
    blurb: "A simplification the results depend on.",
  },
  result: {
    label: "Result",
    plural: "Results",
    icon: TrendingUp,
    color: "var(--status-support)",
    blurb: "An output or finding of the model.",
  },
  cited_work: {
    label: "Cited work",
    plural: "Cited works",
    icon: Library,
    color: "var(--status-contradict)",
    blurb: "Earlier research the paper builds on.",
  },
};

export const KIND_ORDER: ConceptKind[] = [
  "paper",
  "model",
  "concept",
  "variable",
  "parameter",
  "assumption",
  "result",
  "cited_work",
];

export interface LinkMeta {
  label: string;
  color: string;
  dash?: string;
  blurb: string;
}

export const LINK_META: Record<LinkKind, LinkMeta> = {
  prerequisite: {
    label: "Builds on",
    color: "var(--status-link)",
    blurb: "Understand the first to understand the second.",
  },
  supports: {
    label: "Supports",
    color: "var(--status-support)",
    blurb: "The first backs up or produces the second.",
  },
  contradicts: {
    label: "Contradicts",
    color: "var(--status-contradict)",
    dash: "8 4 2 4",
    blurb: "The two are in tension.",
  },
  gap: {
    label: "Caveat / gap",
    color: "var(--status-gap)",
    dash: "5 4",
    blurb: "A limitation or open question.",
  },
};

export const LINK_ORDER: LinkKind[] = ["prerequisite", "supports", "contradicts", "gap"];
