// Animated slide deck contract. Mirrors deck.schema.json, which is generated from backend/tutor/deck.py
// (the source of truth; change the pydantic models, regenerate the schema, then update these types).

export type Color = "blue" | "teal" | "green" | "yellow" | "gold" | "red" | "purple" | "pink" | "white" | "grey";
export type Vec = [number, number];

type Base = { id: string; color?: Color | null };
export type TextObj = Base & { kind: "text"; text: string; x: number; y: number; size?: number; align?: "center" | "left"; axes?: string | null };
export type MathObj = Base & { kind: "math"; latex: string; x: number; y: number; size?: number; align?: "center" | "left"; axes?: string | null };
export type AxesObj = Base & { kind: "axes"; x: number; y: number; w: number; h: number; x_range: Vec; y_range: Vec; x_label?: string; y_label?: string };
export type CurveObj = Base & { kind: "curve"; axes: string; expr: string; x_range?: Vec | null; label?: string };
export type PolylineObj = Base & { kind: "polyline"; points: Vec[]; axes?: string | null };
export type DotObj = Base & { kind: "dot"; axes: string; x: number; curve?: string | null; y?: number | null; label?: string };
export type VectorObj = Base & { kind: "vector"; start: Vec; end: Vec; axes?: string | null; label?: string };
export type TangentObj = Base & { kind: "tangent"; curve: string; dot: string; length?: number };
export type StepArrowObj = Base & { kind: "step_arrow"; dot: string; scale?: number; label?: string };
export type ShapeObj = Base & { kind: "shape"; shape: "rect" | "ellipse" | "line"; x: number; y: number; w: number; h: number; axes?: string | null; fill?: boolean };
export type SliderObj = Base & { kind: "slider"; param: string; min: number; max: number; value: number; x: number; y: number; w?: number; label?: string };

export type SlideObject =
  | TextObj | MathObj | AxesObj | CurveObj | PolylineObj | DotObj | VectorObj | TangentObj | StepArrowObj | ShapeObj | SliderObj;

type ActBase = { with_prev?: boolean };
export type Action = ActBase &
  (
    | { do: "show" | "hide" | "indicate"; ids: string[] }
    | { do: "move"; id: string; to: number }
    | { do: "path"; id: string; xs: number[]; trail?: boolean }
    | { do: "morph"; id: string; latex?: string | null; expr?: string | null }
  );

export type Step = { narration: string; actions: Action[] };
export type Slide = {
  id: string;
  title: string;
  kp_ids?: string[];
  /** Lesson plan (main branch): the one idea, the slide it builds on, the check question before moving on. */
  idea?: string | null;
  builds_on?: string | null;
  check?: string | null;
  objects: SlideObject[];
  steps?: Step[];
};
export type Deck = { title: string; slides: Slide[] };

/** GET/POST /api/tutor/tracks/{id}/deck */
export type DeckView = {
  status: "none" | "generating" | "ready" | "failed";
  source: "generated" | "fallback" | null;
  deck: Deck | null;
  error: string;
  warnings: string[];
  updated_at: string | null;
};

export type StageTab = "board" | "screen" | "slides";

/** What the Slides tab exposes to the agent's RPCs (slides/rpc.ts). Every method replies, never throws. */
export type SlidesHandle = {
  go(index: number): SlidesReply;
  step(step: number): SlidesReply;
  point(objectId: string, holdMs?: number): SlidesReply;
  describe(): SlidesDescription;
  /** The open slide's full JSON (the agent builds follow-up animations from it). */
  current(): Slide | null;
  /** Inserts an extra (follow-up) slide after the current one and opens it. */
  push(slide: unknown): SlidesReply;
  /**
   * Adds objects and steps to the OPEN slide (explain in place, keep the context). The new steps are inserted right
   * after the current step (later steps are renumbered) and are NOT played: the tutor plays `new_steps` with step().
   */
  edit(patch: { objects?: unknown[]; steps?: unknown[] }): SlidesReply;
  /** Removes the student's persistent circle mark (it stays until the tutor has answered). */
  clearCircle(circleId: string): SlidesReply;
  /** Opens the explanation pop-up with its own small animated slide (the main slide stays as it is). */
  explain(slide: unknown): SlidesReply;
  /** Plays step n of the open explanation (reply carries `ms`). */
  explainStep(step: number): SlidesReply;
  /** Closes the explanation pop-up (the student has understood). */
  closeExplanation(): SlidesReply;
};

/**
 * `ms`: how long the step's animation runs (slides.step; the agent waits that long).
 * `steps_added`, `new_steps`: slides.edit, the numbers of the inserted steps in order.
 */
export type SlidesReply = { ok: boolean; errors: string[]; index?: number; step?: number; ms?: number; steps_added?: number; new_steps?: number[] };

export type SlideOutline = { index: number; id: string; title: string; kp_ids: string[]; steps: number; followup?: boolean };
export type SlidesDescription = {
  ok: true;
  index: number;
  step: number;
  slides: SlideOutline[];
  /** The open slide in detail: objects the tutor can point at and the narration hint for each step. */
  current: { id: string; title: string; idea?: string; check?: string; objects: { id: string; kind: string; label?: string }[]; narration: string[] } | null;
  /** Only with `slides.describe {slide: true}`, and only when it fits the RPC reply. */
  slide?: Slide;
};
