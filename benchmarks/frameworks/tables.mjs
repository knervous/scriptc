// Prints RESULTS.md's tables from the receipts: each operation's JavaScript median and every WasmGC lane's ratio to it,
// and the host calls per operation of each WasmGC lane.
//
//   node benchmarks/frameworks/tables.mjs <timings receipt>[,<later receipt>...] [<counts receipt>]
//
// A later timings receipt's lanes replace an earlier one's of the same name (a framework re-run in the same session).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(fs.readFileSync(path.join(here, "receipts", `${name}.json`), "utf8"));
const [timingName, countName] = process.argv.slice(2);
const timing = timingName.split(",").map(load).reduce((acc, r) => {
  for (const l of r.lanes) if (!acc.lanes.includes(l)) acc.lanes.push(l);
  for (const [op, lanes] of Object.entries(r.ops)) Object.assign(acc.ops[op] ??= {}, lanes);
  acc.errors.push(...r.errors);
  return acc;
});
const ops = Object.keys(timing.ops);
const frameworks = [...new Set(timing.lanes.map((l) => l.split(".")[0]))];
const variant = (l) => (l.includes(".") ? l.slice(l.indexOf(".") + 1) : "js");

const fmt = (x) => (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3));
let out = "<table>\n<thead><tr><th>Operation</th>";
for (const f of frameworks) for (const l of timing.lanes.filter((x) => x.split(".")[0] === f)) out += `<th>${f} ${variant(l)}</th>`;
out += "</tr></thead>\n<tbody>\n";
for (const op of ops) {
  out += `<tr><td>${op}</td>`;
  for (const f of frameworks) for (const l of timing.lanes.filter((x) => x.split(".")[0] === f)) {
    const r = timing.ops[op][l];
    out += variant(l) === "js" ? `<td>${fmt(r.median)} ms</td>` : `<td>${r.ratio.toFixed(2)}</td>`;
  }
  out += "</tr>\n";
}
out += "</tbody>\n</table>\n";
console.log(out);
const bad = ops.filter((op) => timing.ops[op].mismatch || timing.lanes.some((l) => timing.ops[op][l].failures));
console.log(`mismatches or failures: ${bad.length ? bad.join(", ") : "none"}; errors: ${timing.errors.length}; ${timing.browser}; ${timing.pages} pages, ${timing.warmup} warmup, ${timing.iterations} timed\n`);

if (countName) {
  const counts = load(countName);
  const lanes = counts.lanes;
  let c = "<table>\n<thead><tr><th>Operation</th>" + lanes.map((l) => `<th>${l}</th>`).join("") + "</tr></thead>\n<tbody>\n";
  for (const op of ops) c += `<tr><td>${op}</td>` + lanes.map((l) => `<td>${Math.round(counts.ops[op]?.[l]?.callsPerOp ?? NaN).toLocaleString("en-US")}</td>`).join("") + "</tr>\n";
  c += "</tbody>\n</table>\n";
  console.log(c);
}
