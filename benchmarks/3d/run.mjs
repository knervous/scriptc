// The scene benchmark in headless Chromium, on WebGL through SwiftShader: each lane's script time per frame (median
// and p95 over every timed frame of every page) at each mesh count, and each WasmGC lane's ratio to the JavaScript lane
// of the same library. GPU time on SwiftShader means nothing; only the frame call's own time is measured.
//
//   node benchmarks/3d/run.mjs --js three=benchmarks/3d/out/three.js --wasm three.wasm=benchmarks/3d/out/three.wasm
//     [--modules three.wasm=benchmarks/3d/out/three-modules.js] [--counts 1000,10000] [--pages 2] [--warmup 30]
//     [--frames 60] [--count] [--receipt <name>]
//
// A lane is `<lib>` (its JavaScript build) or `<lib>.<variant>` (a WasmGC build); --count loads each WasmGC lane once
// with its host imports counted and prints the calls per frame.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const { chromium } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const named = (spec) => { const i = spec.indexOf("="); return { name: spec.slice(0, i), file: spec.slice(i + 1) }; };
const meshCounts = opt("counts", "1000,10000").split(",").map(Number);
const pages = Number(opt("pages", 2)), warmup = Number(opt("warmup", 30)), frames = Number(opt("frames", 60));
const counting = args.includes("--count");
const host = "packages/compiler/dist/backend/wasmgc/host.js";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
// The repository only, on the loopback interface.
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const modulesOf = new Map(all("modules").map(named).map(({ name, file }) => [name, `&modules=/${file}`]));
const lanes = [
  ...(counting ? [] : all("js").map(named).map(({ name, file }) => ({ name, query: `lane=js&js=/${file}` }))),
  ...all("wasm").map(named).map(({ name, file }) => ({ name, query: `lane=wasm&wasm=/${file}&host=/${host}${counting ? "&count=1" : ""}${modulesOf.get(name) ?? ""}` })),
];
// WebGL through SwiftShader, and WebGPU (Babylon Lite needs it) on SwiftShader's adapter.
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] });
const errors = [];
async function open(lane, n) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`${lane.name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${lane.name}: console.error ${m.text()}`); });
  await page.goto(`${origin}/benchmarks/3d/page/index.html?${lane.query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
    .catch((e) => { throw new Error(`${lane.name} never got ready: ${errors.filter((x) => x.startsWith(lane.name)).slice(0, 3).join(" | ") || e.message}`); });
  await page.evaluate((count) => window.bench.setup(count), n);
  return page;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length; return k ? (k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2) : NaN; };
const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))]; };

const probe = await browser.newPage();
await probe.goto(`${origin}/benchmarks/3d/page/index.html?${lanes.find((l) => l.query.startsWith("lane=js"))?.query ?? lanes[0].query}`);
await probe.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
const renderer = await probe.evaluate(() => window.bench?.webgl()).catch(() => null);
await probe.close();
const result = { date: new Date().toISOString(), browser: browser.version(), webgl: renderer, pages, warmup, frames, lanes: lanes.map((l) => l.name), counts: {} };
console.log(`webgl: ${renderer}`);

for (const n of meshCounts) {
  const row = (result.counts[n] = {});
  for (const lane of lanes) {
    const times = [];
    let checksum = null, calls = null;
    for (let p = 0; p < (counting ? 1 : pages); p++) {
      const page = await open(lane, n);
      const r = await page.evaluate(([w, f]) => window.bench.run(w, f), [counting ? 5 : warmup, counting ? 10 : frames]);
      times.push(...r.times);
      checksum = r.checksum;
      calls = r.calls;
      await page.close();
    }
    row[lane.name] = counting
      ? { callsPerFrame: Object.values(calls).reduce((a, b) => a + b, 0) / 10, calls: Object.fromEntries(Object.entries(calls).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v / 10])), checksum }
      : { median: median(times), p95: p95(times), checksum };
  }
  const base = (name) => row[name.split(".")[0]];
  const line = lanes.map((l) => {
    const r = row[l.name];
    if (counting) return `${l.name}: ${r.callsPerFrame} host calls per frame  ${Object.entries(r.calls).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(" ")}`;
    const b = base(l.name), ratio = b && b !== r ? ` ×${(r.median / b.median).toFixed(2)}` : "";
    const same = b && b !== r && b.checksum !== r.checksum ? ` CHECKSUM ${r.checksum} vs ${b.checksum}` : "";
    return `${l.name}: ${r.median.toFixed(3)} ms (p95 ${r.p95.toFixed(3)})${ratio}${same}`;
  });
  console.log(`${String(n).padEnd(6)} ${line.join("  ")}`);
}
result.errors = errors;
if (errors.length) console.log(`errors: ${errors.slice(0, 5).join(" | ")}`);
const receipt = opt("receipt", null);
if (receipt) { fs.mkdirSync(path.join(here, "receipts"), { recursive: true }); fs.writeFileSync(path.join(here, "receipts", `${receipt}.json`), JSON.stringify(result, null, 1) + "\n"); }
await browser.close();
server.close();
