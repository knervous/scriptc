// Where the browser gate's fixtures and receipts live.
//
// The public fixtures are fixtures/ here, and receipts go to reports/ here. A checkout kept beside this one can add its
// own through the environment, each a list of paths separated by the platform's path delimiter (`:`, `;` on Windows):
//
//   SCRIPTC_EXTRA_FIXTURES  fixture directories gated after the public ones (with the helpers only they import);
//   SCRIPTC_GATE_REPORTS    receipt directories: a run writes to the first, and readers of past receipts
//                           (corpus-triage.mjs) look in all of them, then in reports/ here.
//
// A fixture's name is unique across the directories.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The absolute paths of a path-list variable; each must be an existing directory. */
function dirList(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return [];
  return value.split(path.delimiter).filter((p) => p !== "").map((p) => {
    const dir = path.resolve(p);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${name}: ${dir} is not a directory`);
    return dir;
  });
}

export const publicFixtures = path.join(here, "fixtures");
/** The directories SCRIPTC_EXTRA_FIXTURES adds, in order. */
export const extraFixtures = dirList("SCRIPTC_EXTRA_FIXTURES");
/** Every fixture directory, the public one first. */
export const fixtureDirs = [publicFixtures, ...extraFixtures];
/** Every receipt directory: SCRIPTC_GATE_REPORTS's, then the public one. */
export const reportDirs = [...dirList("SCRIPTC_GATE_REPORTS"), path.join(here, "reports")];
/** Where a gate run writes its receipt. */
export const reportsDir = reportDirs[0];

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
