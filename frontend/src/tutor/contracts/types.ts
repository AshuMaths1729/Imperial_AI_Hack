// Shared tutor contracts (README §8). Mirrors board_ops.schema.json; change both together.

/** Board units: 0–1000 on both axes. */
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
  source: "board" | "screen";
};

export type BoardHandle = {
  applyOps(ops: unknown[]): ApplyResult;
  describe(): BoardDescription;
  snapshot(region?: Box): Promise<string>;
  setCircleMode(on: boolean): void;
};

export type BoardRpcMethod = "board.apply" | "board.describe" | "board.snapshot";
