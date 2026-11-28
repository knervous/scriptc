// Runs the table benchmark in headless Chromium and prints each operation's median and p95 per lane, with each
// WasmGC lane's ratio to JavaScript.
//
//   node benchmarks/react-dom/run.mjs --wasm <path.wasm> [--wasm <other.wasm>] [--pages 3] [--warmup 5]
//     [--iterations 10] [--ops create1k,update10th] [--count] [--receipt <name>]
//
// Every sample runs on a fresh page per (operation, lane, round), and the lanes' order rotates by round. --count
// instead loads each WasmGC lane once with its host imports counted and prints the calls per operation (timings
// from that run are not reported). Paths are relative to the repository root, which the runner serves.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
// Playwright is resolved as the environment provides it (a global install works), not as a dependency of this package.
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(here, "../..");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const pages = Number(opt("pages", 3)), warmup = Number(opt("warmup", 5)), iterations = Number(opt("iterations", 10));
const counting = args.includes("--count");
const host = opt("host", "packages/compiler/dist/backend/wasmgc/host.js");
const wasmLanes = all("wasm");
const jsBuild = opt("js", "benchmarks/react-dom/out/app.js");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store",
    // Cross-origin isolated, so performance.now() has its fine resolution.
    "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const lanes = [
  ...(counting ? [] : [{ name: "js", query: `lane=js&js=/${jsBuild}` }]),
  ...wasmLanes.map((w) => ({ name: path.basename(w), query: `lane=wasm&wasm=/${w}&host=/${host}${counting ? "&count=1" : ""}` })),
  // --bridge <path.wasm>: a build whose DOM goes through the DOM stream (packages/dom-stream), with its page half.
  ...all("bridge").map((w) => ({ name: path.basename(w), query: `lane=wasm&wasm=/${w}&host=/${host}&bridge=/packages/dom-stream/src/dom-host.js${counting ? "&count=1" : ""}` })),
];

const browser = await chromium.launch();
const errors = [];

async function openLane(lane) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`${lane.name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${lane.name}: console.error ${m.text()}`); });
  await page.goto(`${origin}/benchmarks/react-dom/page/index.html?${lane.query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}

const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

const probe = await openLane(lanes[0]);
const allOps = await probe.evaluate(() => window.bench.ops);
await probe.close();
const ops = (opt("ops", null)?.split(",") ?? allOps);

const result = { date: new Date().toISOString(), browser: browser.version(), pages, warmup, iterations, lanes: lanes.map((l) => l.name), ops: {} };

if (counting) {
  for (const lane of lanes) {
    const page = await openLane(lane);
    for (const op of ops) {
      await page.evaluate(() => window.bench.takeCounts());
      const r = await page.evaluate(([o, w, n]) => window.bench.run(o, w, n), [op, 1, 3]);
      const c = await page.evaluate(() => window.bench.takeCounts());
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      const per = (n) => +(n / 3).toFixed(1);
      const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${per(v)}`).join(" ");
      console.log(`${lane.name} ${op}: ${per(total)} host calls per op${r.failures.length ? " FAILED" : ""}  ${top}`);
      (result.ops[op] ??= {})[lane.name] = { callsPerOp: per(total), calls: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, per(v)])) };
    }
    await page.close();
  }
} else {
  for (const op of ops) {
    const per = Object.fromEntries(lanes.map((l) => [l.name, { script: [], layout: [], failures: 0, prints: new Set() }]));
    for (let round = 0; round < pages; round++) {
      for (let k = 0; k < lanes.length; k++) {
        const lane = lanes[(round + k) % lanes.length];
        const page = await openLane(lane);
        // Creating 10,000 rows takes long enough that a third of the samples does.
        const heavy = op === "create10k";
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 300000));
        const r = await Promise.race([page.evaluate(([o, w, n]) => window.bench.run(o, w, n), [op, heavy ? Math.min(2, warmup) : warmup, heavy ? Math.max(3, Math.ceil(iterations / 3)) : iterations]), timeout]);
        await page.close();
        if (r === null) { errors.push(`${lane.name}: ${op} timed out`); per[lane.name].failures++; continue; }
        const p = per[lane.name];
        for (const s of r.samples) { p.script.push(s.script); p.layout.push(s.layout); }
        p.failures += r.failures.length;
        p.prints.add(r.prints.join("|"));
      }
    }
    const js = per.js;
    const line = [op.padEnd(11)];
    result.ops[op] = {};
    for (const lane of lanes) {
      const p = per[lane.name];
      const m = median(p.script), p95 = quantile(p.script, 0.95), lm = median(p.layout);
      const ratio = lane.name === "js" ? 1 : m / median(js.script);
      result.ops[op][lane.name] = { median: m, p95, layoutMedian: lm, ratio, failures: p.failures, samples: p.script, layout: p.layout };
      line.push(`${lane.name}: ${m.toFixed(3)} ms (p95 ${p95.toFixed(3)}, layout ${lm.toFixed(2)})${lane.name === "js" ? "" : ` ×${ratio.toFixed(2)}`}${p.failures ? ` FAILED ${p.failures}` : ""}`);
    }
    const prints = new Set(lanes.flatMap((l) => [...per[l.name].prints]));
    if (prints.size > 1) { line.push("MISMATCH between lanes"); result.ops[op].mismatch = true; }
    console.log(line.join("  "));
  }
}

await browser.close();
server.close();
result.errors = errors;
if (errors.length) console.log(`errors:\n  ${[...new Set(errors)].slice(0, 20).join("\n  ")}`);
const receipt = opt("receipt", null);
if (receipt) {
  fs.mkdirSync(path.join(here, "receipts"), { recursive: true });
  fs.writeFileSync(path.join(here, "receipts", `${receipt}.json`), JSON.stringify(result, null, 1) + "\n");
}
