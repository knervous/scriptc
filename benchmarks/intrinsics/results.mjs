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
const isThreadLane = (n) => n.endsWith("(median)") || n === "js 4 workers" || n === "js threads=off (task ring)" || n.startsWith("wasmgc threads=shared") || n.startsWith("native threads");
const cell0 = (r, name) => { const l = r.lanes[name], js = (r.lanes["js (median)"] ?? r.lanes["js"])?.times?.time; return l?.times ? `${fmt(l.times.time)} ms (${(l.times.time / js).toFixed(2)}×) ${l.match ? "✓" : "✗"}` : "n/a"; };
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
  const extra = Object.keys(r.lanes).filter((n) => !LANES.includes(n) && !isThreadLane(n)).map((n) => `${n}: ${cell(n)}`).join("<br>");
  lines.push(`| ${r.app} | ${LANES.map(cell).join(" | ")} | ${extra} |`);
}
// The thread lanes (blur/lanes.mjs): every column a ratio to the single-threaded JS reference (`js (median)`: the js
// lane's program, run like the thread lanes), absolute ms first.
const threaded = receipts.filter((r) => Object.keys(r.lanes).some(isThreadLane));
if (threaded.length) {
  const COLS = [["js (median)", "JS"], ["js+fallback (median)", "JS (main.ts)"], ["js 4 workers", "JS 4 workers"], ["wasmgc", "WasmGC threads=off"],
    ...[1, 2, 4].map((n) => [`wasmgc threads=shared ${n}`, `WasmGC shared ${n}`]), ["native", "native"],
    ...[1, 2, 4].map((n) => [`native threads ${n}`, `native threads ${n}`])];
  const BROWSER = [1, 2, 4].map((n) => `wasmgc threads=shared chromium ${n}`);
  lines.push("", "## Threads", "");
  lines.push(`Machine: ${first.cpus} cores (${first.cpu}). Every lane here is the median of its recorded runs (\`runs\` in the receipt), and each ratio is over the JS column: \`baseline.ts\` under Node, run the same way. The JS 4 workers, WasmGC and native lanes run the kernel of \`main.ts\` (the JS (main.ts) column: bands claimed from a WorkCounter) on one shared image, except WasmGC threads=off and native, which are the main table's single runs of main.ts; the WasmGC shared lanes run under Node's worker_threads, and the Chromium row runs the same module in headless Chromium, cross-origin isolated, one module Worker per thread.`, "");
  lines.push("| App | " + COLS.map(([, h]) => h).join(" | ") + " |", "|---|" + COLS.map(() => "---|").join(""));
  for (const r of threaded) {
    const js = (r.lanes["js (median)"] ?? r.lanes["js"])?.times?.time;
    const cell = (name) => { const l = r.lanes[name]; if (!l) return ""; if (l.error) return "n/a"; const t = l.times.time; return `${fmt(t)} (${(t / js).toFixed(2)}×) ${l.match ? "✓" : "✗"}`; };
    lines.push(`| ${r.app} | ${COLS.map(([n]) => cell(n)).join(" | ")} |`);
    if (BROWSER.some((n) => r.lanes[n])) {
      const at = COLS.findIndex(([n]) => n === "wasmgc threads=shared 1");
      lines.push(`| ${r.app}, Chromium | ${COLS.map(([n], i) => (i >= at && i < at + 3 ? cell(BROWSER[i - at]) : i === 0 ? cell("js (median)") : "")).join(" | ")} |`);
    }
  }
  lines.push("");
  for (const r of threaded) {
    const keys = [...new Set(Object.values(r.lanes).map((l) => l.capabilities).filter(Boolean))];
    const ring = r.lanes["js threads=off (task ring)"];
    lines.push(`- **${r.app}**: the WasmGC shared build records \`${keys.join("`, `")}\`.${ring?.times ? ` The task ring's owner-thread drain (threads=off): ${cell0(r, "js threads=off (task ring)")}.` : ""}`);
  }
  lines.push("");
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
