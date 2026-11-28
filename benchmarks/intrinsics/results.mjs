#!/usr/bin/env node
// Writes RESULTS.md from receipts/*.json (run.mjs writes the receipts).  node benchmarks/intrinsics/results.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ["hash", "qoi", "lz4", "bitset", "physics", "snapshot", "particles", "f16-mesh", "blur"];
const receipts = ORDER.map((a) => path.join(here, "receipts", `${a}.json`)).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const LANES = ["js", "js+fallback", "wasmgc-base", "wasmgc", "native-base", "native"];
const fmt = (v) => (v === undefined ? "" : v >= 100 ? v.toFixed(0) : v.toFixed(1));
const lines = [];
const first = receipts[0];
lines.push("# Results", "");
lines.push(`One receipt per benchmark, written by \`run.mjs\` (receipts/*.json). Machine: ${first.platform}, ${first.cpus} × ${first.cpu}, Node ${first.node}. Date: ${first.date.slice(0, 10)}.`, "");
lines.push("Times are milliseconds measured inside each program around the work only (no startup, no compilation). Ratios are the lane's time over the `js` lane's (lower is faster). Every lane's result lines (checksums, sizes, hashes) were compared with the `js` lane's; ✓ means byte-identical. Single runs: differences under about 10% are noise.", "");
lines.push("| App | " + LANES.join(" | ") + " | extra lanes |", "|---|" + LANES.map(() => "---|").join("") + "---|");
for (const r of receipts) {
  const js = r.lanes["js"]?.times?.time;
  const cell = (name) => {
    const l = r.lanes[name];
    if (!l) return "";
    if (l.error) return "n/a";
    const t = l.times.time;
    return `${fmt(t)} (${(t / js).toFixed(2)}×) ${l.match ? "✓" : "✗"}`;
  };
  const extra = Object.keys(r.lanes).filter((n) => !LANES.includes(n)).map((n) => `${n}: ${cell(n)}`).join("<br>");
  lines.push(`| ${r.app} | ${LANES.map(cell).join(" | ")} | ${extra} |`);
}
lines.push("", "## Per kernel", "");
for (const r of receipts) {
  const keys = Object.keys(r.lanes["js"]?.times ?? {}).filter((k) => k !== "time");
  if (!keys.length) continue;
  lines.push(`**${r.app}**`, "", "| Kernel | " + LANES.join(" | ") + " |", "|---|" + LANES.map(() => "---|").join(""));
  for (const k of keys) lines.push(`| ${k.slice(5)} | ${LANES.map((n) => (r.lanes[n]?.times ? fmt(r.lanes[n].times[k]) : "n/a")).join(" | ")} |`);
  lines.push("");
}
lines.push("## Results each lane printed", "");
for (const r of receipts) lines.push(`- **${r.app}**: \`${r.results.join(" / ")}\``);
lines.push("", "## Binary sizes", "", "| App | wasmgc-base | wasmgc | native-base | native |", "|---|---|---|---|---|");
for (const r of receipts) lines.push(`| ${r.app} | ${["wasmgc-base", "wasmgc", "native-base", "native"].map((n) => (r.lanes[n]?.bytes ? `${(r.lanes[n].bytes / 1024).toFixed(1)} KiB` : "n/a")).join(" | ")} |`);
lines.push("");
const refusals = receipts.flatMap((r) => Object.entries(r.lanes).filter(([, l]) => l.error).map(([n, l]) => `- ${r.app} ${n}: ${l.error}`));
if (refusals.length) lines.push("## Lanes that did not run", "", ...refusals, "");
const notes = fs.existsSync(path.join(here, "results-notes.md")) ? fs.readFileSync(path.join(here, "results-notes.md"), "utf8") : "";
fs.writeFileSync(path.join(here, "RESULTS.md"), lines.join("\n") + (notes ? "\n" + notes : ""));
console.log(`results: ${receipts.length} receipts`);
