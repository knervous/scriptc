// Where the browser gate's fixtures and receipts live.
//
// The public fixtures are fixtures/ here. The private layer keeps its own beside them, in
// private/tests/wasmgc-browser/fixtures (fixtures the export leaves out, and the helpers only they import), and the
// gate's receipts in private/tests/wasmgc-browser/reports. A tree without private/ (an export) has the public ones
// alone and writes receipts to reports/ here. A fixture's name is unique across the directories.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const privateRoot = path.join(here, "../../private/tests/wasmgc-browser");

export const publicFixtures = path.join(here, "fixtures");
export const privateFixtures = path.join(privateRoot, "fixtures");
/** Every fixture directory of this tree, the public one first. */
export const fixtureDirs = [publicFixtures, ...(fs.existsSync(privateFixtures) ? [privateFixtures] : [])];
/** Where a gate run writes its receipt. */
export const reportsDir = fs.existsSync(path.join(privateRoot, "reports")) ? path.join(privateRoot, "reports") : path.join(here, "reports");

/** name -> absolute path of `<name>.ts`, for every fixture of `dirs`, in name order. Two fixtures of one name refuse. */
export function fixtureIndex(dirs = fixtureDirs) {
  const index = new Map();
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue; // as the gate always listed them: an ambient `<name>.d.ts` beside the fixtures is one too
      const name = f.slice(0, -3);
      if (index.has(name)) throw new Error(`fixture ${name} is in both ${path.dirname(index.get(name))} and ${dir}`);
      index.set(name, path.join(dir, f));
    }
  }
  return new Map([...index].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
