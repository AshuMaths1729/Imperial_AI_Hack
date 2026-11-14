// Shared tutor contracts (README §8). Mirrors board_ops.schema.json; change both together.

/** Board units: x 0–1000; y 0–3000 (the page grows downward like paper; the camera follows the pen). */
export type Box = { x: number; y: number; w: number; h: number };

export type Place = string; // "next" | `below:${id}` | `right_of:${id}` | `region:${x},${y},${w},${h}`

type Steppable = { group?: string; step?: number };

export type BoardOp =
  | ({ op: "write_text"; id?: string; text: string; place: Place } & Steppable)
  | ({ op: "write_math"; id?: string; latex: string; place: Place } & Steppable)
  | ({ op: "draw_shape"; id?: string; shape: "rect" | "ellipse" | "line"; label?: string; place: Place } & Steppable)
  | ({ op: "draw_arrow"; id?: string; from_id: string; to_id: string; label?: string } & Steppable)
  | ({ op: "plot_function"; id?: string; expr?: string; points?: [number, number][]; x_range: [number, number]; label?: string; place: Place } & Steppable)
  | ({ op: "place_image"; id?: string; url: string; caption?: string; place: Place } & Steppable)
  | { op: "highlight"; target_id: string; color?: "yellow" | "red" | "green" | "blue" | "violet" }
  | { op: "reveal_step"; group_id: string; step: number }
  /** Laser pointer: moves to the item and stays `hold_ms` (default ~2500), then fades. Never stored on the board. */
  | { op: "point_at"; target_id: string; hold_ms?: number }
  /** Hand-drawn mark around/under an item or region (e.g. circle the student's mistake in red). */
  | { op: "annotate"; id?: string; mark: "circle" | "underline" | "cross" | "tick"; target_id?: string; region?: Box; color?: "yellow" | "red" | "green" | "blue" | "violet" }
  /** Move/zoom the camera to an item or region (the camera also follows tutor writing automatically). */
  | { op: "focus"; target_id?: string; region?: Box }
  | { op: "erase"; target_id: string }
  | { op: "clear_tutor_layer" };

export type ApplyResult = { ok: boolean; ids: string[]; errors: string[] };

export type BoardItem = {
  id: string;
  type: string;
  author: "tutor" | "user";
  text?: string;
  latex?: string;
  label?: string;
  bbox: Box;
};

export type BoardDescription = { items: BoardItem[] };

export type CircleEvent = {
  png_b64: string;
  region: Box;
  item_ids: string[];
  user_text?: string;
  source: "board" | "screen" | "slide";
  /** Set when source is "slide": which slide and which of its objects were circled. */
  slide_id?: string;
};

/** Sent on the "tutor.idle" text stream when the student wrote, then stopped for a while. Region is the student's recent ink. */
export type IdleEvent = {
  png_b64: string;
  mime: string;
  region: Box;
  item_ids: string[];
  idle_ms: number;
};

/** Board extension (laser, idle watcher, …). Runs once on mount; returns its cleanup. */
export type BoardPluginContext = {
  editor: import("tldraw").Editor;
  /** Send a JSON payload to the agent on a LiveKit text-stream topic. */
  emit: (topic: string, payload: unknown) => void;
  snapshot: (region?: Box) => Promise<string>;
  describe: () => BoardDescription;
};
export type BoardPlugin = (ctx: BoardPluginContext) => (() => void) | void;

export type BoardHandle = {
  applyOps(ops: unknown[]): ApplyResult;
  describe(): BoardDescription;
  snapshot(region?: Box): Promise<string>;
  setCircleMode(on: boolean): void;
};

export type BoardRpcMethod = "board.apply" | "board.describe" | "board.snapshot";
