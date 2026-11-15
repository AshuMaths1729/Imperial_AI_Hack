/**
 * Fixture-backed variants of `getGraph/getSim/askSpatial` for the offline demo.
 * `NEXT_PUBLIC_DATA_SOURCE=fixtures|live` (default live). JSON is fetched from `/fixtures/*.json`
 * (copy of `../fixtures`, refresh with `npm run sync:fixtures`). Type-only imports from ./types so
 * this module never creates a cycle with endpoints.ts.
 */
import type { AskSpatialRequest, AskSpatialResponse, Graph, SimPayload, SimSpec } from "./types";

export type DataSource = "fixtures" | "live";
export const DATA_SOURCE: DataSource =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "fixtures" ? "fixtures" : "live";
export const USE_FIXTURES = DATA_SOURCE === "fixtures";

const cache = new Map<string, Promise<unknown>>();

export function loadFixture<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`/fixtures/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`fixture ${name}.json: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(name)); // never cache failures
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export function fixtureGetGraph(graphId: string): Promise<Graph> {
  const hypothesis = /hyp/i.test(graphId);
  return loadFixture<Graph>(hypothesis ? "hypothesis_graph" : "lecture_graph");
}

export async function fixtureGetSim(simId: string): Promise<SimSpec> {
  const payload = await loadFixture<SimPayload>("sim_heavy_ball");
  return { ...payload, sim_id: simId || "sim_heavy_ball" };
}

export function fixtureAskSpatial(req: AskSpatialRequest): Promise<AskSpatialResponse> {
  return loadFixture<AskSpatialResponse>(`ask_spatial_${req.active_context.view}`);
}
