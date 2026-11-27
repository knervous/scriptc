// The slice gate: the gate on the fixtures a change touches plus a fixed
// smoke set, in all three lanes, a few minutes instead of the full run's
// hour and a half. The full gate (gate.mjs, every fixture, three lanes) stays
// the milestone check.
//
//   node slice.mjs [--grep REGEX] [--smoke N] [fixture ...]
//
//   fixture ...    fixtures by name (without .ts)
//   --grep REGEX   every fixture whose source or name matches REGEX
//                  (the construct the change touches: "static get|WeakMap")
//   --native-sim   only the native-host simulation lane (gate.mjs --native-sim): every named or
//                  matching hostHandles fixture with SCRIPTC_WASMGC_NATIVE_SIM=1; the other lanes
//                  and the smoke set are not run
//   --fuse-casts   every lane with fuseTestCasts (gate.mjs --fuse-casts)
//   --smoke N      the first N fixtures of every large name family (7+
//                  fixtures; default 1): a cheap pass over each area of the corpus
//
// Lanes: engine, native, native-any; two at a time, one gate worker each
// (the machine's two-heavy-processes ceiling).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureIndex } from "./fixture-dirs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureFiles = fixtureIndex(); // the public fixtures and, with the private layer, its own
const argv = process.argv.slice(2);
const option = (f, dflt) => { const i = argv.indexOf(f); if (i < 0) return dflt; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const grep = option("--grep", null);
const smoke = Number(option("--smoke", "1"));
const simOnly = (() => { const i = argv.indexOf("--native-sim"); if (i < 0) return false; argv.splice(i, 1); return true; })();
const fuseCasts = (() => { const i = argv.indexOf("--fuse-casts"); if (i < 0) return false; argv.splice(i, 1); return true; })();
const named = argv;

const all = [...fixtureFiles.keys()];
const unknown = named.filter((n) => !all.includes(n));
if (unknown.length) throw new Error(`no such fixture: ${unknown.join(", ")}`);

const picked = new Set(named);
if (grep) {
  const re = new RegExp(grep);
  for (const name of all) if (re.test(name) || re.test(fs.readFileSync(fixtureFiles.get(name), "utf8"))) picked.add(name);
}
const families = new Map();
for (const name of all) {
  const family = name.split("-")[0];
  families.set(family, [...(families.get(family) ?? []), name]);
}
if (!simOnly) for (const list of families.values()) if (list.length >= 7) for (const name of list.slice(0, smoke)) picked.add(name);
const names = [...picked].sort();

const laneArgs = simOnly ? [["native-sim", ["--native-sim"]]] : [["engine", []], ["native", ["--dyn", "native"]], ["native-any", ["--dyn", "native", "--native-any"]]];
const lanes = laneArgs.map(([lane, args]) => [lane, fuseCasts ? [...args, "--fuse-casts"] : args]);
console.log(`slice: ${names.length} of ${all.length} fixtures (${named.length} named, grep ${grep ? `/${grep}/` : "none"}, smoke ${smoke}/large family) x ${lanes.length} lanes`);
const started = Date.now();

const runLane = ([lane, flags]) => new Promise((resolve) => {
  const child = spawn("nice", ["-n", "10", process.execPath, path.join(here, "gate.mjs"), ...flags, "--jobs", "1", ...names], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => {
    const summary = out.match(/^\d+\/\d+ passed.*$/m)?.[0] ?? `(no summary, exit ${code})`;
    const failures = out.split("\n").filter((l) => l.startsWith("FAIL"));
    resolve({ lane, code, summary: summary.replace(/\s*\(receipt.*$/, "").replace(/, \d+ by declared.*$/, ""), failures });
  });
});

const results = [];
const queue = [...lanes];
await Promise.all([0, 1].map(async () => { for (let next; (next = queue.shift()); ) results.push(await runLane(next)); }));
results.sort((a, b) => lanes.findIndex(([l]) => l === a.lane) - lanes.findIndex(([l]) => l === b.lane));
for (const r of results) {
  console.log(`${r.lane.padEnd(10)} ${r.summary}`);
  for (const f of r.failures) console.log(`  ${f.slice(0, 220)}`);
}
console.log(`slice: ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exitCode = results.every((r) => r.failures.length === 0 && r.code === 0) ? 0 : 1;
