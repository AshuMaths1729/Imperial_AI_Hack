import Ajv2020 from "ajv/dist/2020";
import schema from "../contracts/board_ops.schema.json";
import type { BoardOp } from "../contracts/types";

export type { BoardOp, ApplyResult, Box } from "../contracts/types";

const ajv = new Ajv2020({ allErrors: false });
ajv.addSchema(schema);
const OP_NAMES = Object.keys(schema.$defs).filter((k) => (schema.$defs as Record<string, { properties?: { op?: unknown } }>)[k].properties?.op);
// One validator per op type gives a precise error instead of a wall of oneOf failures.
const validators = new Map(OP_NAMES.map((name) => [name, ajv.getSchema(`${schema.$id}#/$defs/${name}`)!]));

/**
 * Schema-check one op and make sure every id it references already exists. Never throws.
 * Student items (`studentIds`) may be pointed at (highlight, arrows, places) but never replaced or erased.
 */
export function validateOp(op: unknown, existingIds: Set<string>, studentIds: Set<string> = new Set()): { op: BoardOp } | { error: string } {
  if (!op || typeof op !== "object" || Array.isArray(op)) return { error: "op must be an object" };
  const name = (op as { op?: unknown }).op;
  const validate = typeof name === "string" ? validators.get(name) : undefined;
  if (!validate) return { error: `unknown op ${JSON.stringify(name)}` };
  if (!validate(op)) return { error: `${name}: ${ajv.errorsText(validate.errors, { dataVar: "op" })}` };

  const o = op as BoardOp;
  const refs: string[] = [];
  if ("from_id" in o) refs.push(o.from_id, o.to_id);
  if ("target_id" in o && o.target_id) refs.push(o.target_id);
  if ("place" in o) {
    const m = /^(?:below|right_of):(.+)$/.exec(o.place);
    if (m) refs.push(m[1]);
  }
  const missing = refs.filter((id) => !existingIds.has(id));
  if (missing.length) return { error: `${name}: unknown id ${missing.map((id) => `"${id}"`).join(", ")}` };
  const owned = o.op === "erase" ? o.target_id : "id" in o ? o.id : undefined;
  if (owned && studentIds.has(owned)) return { error: `${name}: id "${owned}" belongs to the student` };
  return { op: o };
}
