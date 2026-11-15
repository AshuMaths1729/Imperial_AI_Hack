import { FlaskConical, GraduationCap, Network, type LucideIcon } from "lucide-react";
import type { WorkspaceMode } from "./types/scholartwin";
import type { SceneKind } from "./components/nature/paint";
import type { HeaderTone } from "./components/AppHeader";

/**
 * The three modules, named for what they do. The ids are unchanged internal keys (routes,
 * storage, API modes), so only the words people see live here. Every screen takes its module's
 * name, description, icon, hue and landscape from this one table.
 */
export type ModuleInfo = {
  id: WorkspaceMode;
  name: string;
  /** Verb shown above the name on Home ("Learn", "Experiment", "Question"). */
  verb: string;
  /** One plain sentence: what you can do here. */
  description: string;
  /** Call to action on the Home card. */
  cta: string;
  icon: LucideIcon;
  /** Module hue as an AppHeader tone (accent = moss, support = spruce, gap = heather). */
  tone: HeaderTone;
  /** CSS colour token of the hue. */
  hue: string;
  scene: SceneKind;
};

export const MODULES: Record<WorkspaceMode, ModuleInfo> = {
  lecture: {
    id: "lecture",
    name: "Live Lessons",
    verb: "Learn",
    description: "A tutor teaches you face to face, with slides and a whiteboard, and remembers where you left off.",
    cta: "Choose a tutor",
    icon: GraduationCap,
    tone: "accent",
    hue: "var(--accent)",
    scene: "meadow",
  },
  paper2sim: {
    id: "paper2sim",
    name: "Paper Simulator",
    verb: "Experiment",
    description: "Drop in a paper and get its equations as a live chart. Move the sliders and watch what changes.",
    cta: "Open a paper",
    icon: FlaskConical,
    tone: "support",
    hue: "var(--status-support)",
    scene: "hills",
  },
  hypothesis: {
    id: "hypothesis",
    name: "Evidence Map",
    verb: "Question",
    description: "Ask a research question and see which papers agree, which disagree, and what nobody has tested yet.",
    cta: "Ask a question",
    icon: Network,
    tone: "gap",
    hue: "var(--status-gap)",
    scene: "lake",
  },
};

export const MODULE_ORDER: WorkspaceMode[] = ["lecture", "paper2sim", "hypothesis"];
