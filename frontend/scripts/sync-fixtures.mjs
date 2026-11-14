// Copies ../fixtures/*.json -> public/fixtures/ (used by src/api/fixtures.ts in fixtures mode).
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "..", "fixtures");
const dst = join(root, "public", "fixtures");
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".json")) {
    copyFileSync(join(src, f), join(dst, f));
    n++;
  }
}
console.log(`synced ${n} fixtures -> public/fixtures`);
