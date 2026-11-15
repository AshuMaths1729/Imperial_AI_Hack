/**
 * Dev hook: `import { installDevApi } from "@/api/dev"; installDevApi();` once (e.g. in a client
 * effect) and poke the API from the browser console: `await __api.getGraph("g_demo_lecture")`.
 */
import * as endpoints from "./endpoints";
import * as segments from "./segments";
import { DATA_SOURCE } from "./fixtures";

export function installDevApi(): void {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  (window as unknown as { __api: unknown }).__api = { ...endpoints, ...segments, DATA_SOURCE };
}
