// The DOM stream's sources that src/dom-stream.ts needs, copied into src/stream/ so the package works on its own
// (npm pack): packages/dom-stream/src and packages/host-stream/src, at the same relative layout, so their own relative
// imports hold. The copies are not edited; regenerate them with this script whenever those packages change.
//
//   node packages/lui/scripts/sync-stream.mjs [--check]
//
// --check compares instead of writing, and fails when a copy is out of date (test/stream-copy.test.ts runs it).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const packages = path.resolve(pkg, "..");
export const FILES = [
  "dom-stream/src/dom.ts", "dom-stream/src/dom-stream.generated.ts", "dom-stream/src/dom-imports.d.ts",
  "dom-stream/src/dom-host.js", "dom-stream/src/dom-stream.generated.js",
  "host-stream/src/stream.ts", "host-stream/src/host-stream.d.ts", "host-stream/src/host.js",
];
const HEADER = (f) => `// Copied from packages/${f} by packages/lui/scripts/sync-stream.mjs. Do not edit; edit the original and run the script.\n`;

export function stale() {
  const out = [];
  for (const f of FILES) {
    const want = HEADER(f) + fs.readFileSync(path.join(packages, f), "utf8");
    const at = path.join(pkg, "src/stream", f);
    if (!fs.existsSync(at) || fs.readFileSync(at, "utf8") !== want) out.push(f);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const s = stale();
    for (const f of s) console.error(`packages/lui/src/stream/${f} is out of date: run packages/lui/scripts/sync-stream.mjs`);
    process.exit(s.length ? 1 : 0);
  }
  for (const f of FILES) {
    const at = path.join(pkg, "src/stream", f);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, HEADER(f) + fs.readFileSync(path.join(packages, f), "utf8"));
  }
}
