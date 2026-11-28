// Splits one lane's time per operation by where it was spent, from a V8 CPU profile of the page:
//   compiled  WasmGC functions (the compiled program and its runtime)
//   boundary  the host's JavaScript (host.js, the bridge's host side): the import calls and their conversions
//   natives   engine natives the host's JavaScript calls: the DOM operations themselves, and the host's builtins
//   dom       the page's own script and the natives it calls (for the JavaScript lane, all of React and the DOM)
//   gc        the garbage collector
// The layout each sample forces after its commit (in bench-page.js's click) is left out of the split.
//
//   node benchmarks/react-dom/profile.mjs --wasm <path.wasm> [--ops create1k,select] [--iterations 10]
//   node benchmarks/react-dom/profile.mjs --js [--ops ...]
//
// Sampling adds overhead and the split is approximate; use run.mjs for timings.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const { chromium } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : args[i + 1]; };
const wasm = opt("wasm", null);
const host = opt("host", "packages/compiler/dist/backend/wasmgc/host.js");
const iterations = Number(opt("iterations", 10));
const hostFiles = (opt("host-files", "host.js,dom-host.js,host-stream/src/host.js,dom-stream.generated.js")).split(",");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const extra = opt("query", "") ? "&" + opt("query", "") : "";
// --query js=/benchmarks/react-dom/out/app.named.js profiles an unminified JavaScript build.
const query = wasm ? `lane=wasm&wasm=/${wasm}&host=/${host}${extra}` : `lane=js${extra}`;

const browser = await chromium.launch();
const ops = opt("ops", "create1k,replace1k,update10th,select,swap,remove,append1k,clear,cycle").split(",");
const classify = (frame) => {
  const { url, functionName } = frame;
  if (functionName === "(garbage collector)") return "gc";
  if (functionName === "(idle)" || functionName === "(program)" || functionName === "(root)") return "other";
  if (url.startsWith("wasm://")) return "compiled";
  // click's own frame after its await: the forced layout, timed apart from script by run.mjs.
  if (functionName === "click" && url.endsWith("bench-page.js")) return "layout";
  if (hostFiles.some((h) => url.endsWith(h))) return "boundary";
  return "dom";
};
for (const op of ops) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/benchmarks/react-dom/page/index.html?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate(([o]) => window.bench.run(o, 3, 2), [op]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 50 });
  // Only the timed steps are sampled: each sample's setup runs with the profiler stopped, and the profiles are merged.
  const r = { samples: [] };
  const merged = { nodes: new Map(), samples: [], timeDeltas: [] };
  for (let i = 0; i < iterations; i++) {
    await page.evaluate(([o]) => window.bench.setup(o), [op]);
    await cdp.send("Profiler.start");
    r.samples.push(await page.evaluate(([o]) => window.bench.step(o), [op]));
    const { profile: one } = await cdp.send("Profiler.stop");
    // Node ids are per profile: offset each one's into the merged id space.
    const base = i * 1000000;
    for (const n of one.nodes) merged.nodes.set(n.id + base, { ...n, id: n.id + base, children: (n.children ?? []).map((c) => c + base) });
    for (const id of one.samples) merged.samples.push(id + base);
    merged.timeDeltas.push(...one.timeDeltas);
  }
  const profile = { nodes: [...merged.nodes.values()], samples: merged.samples, timeDeltas: merged.timeDeltas };
  await page.close();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n);
  // A native (no script URL) is charged to its nearest scripted caller: under the boundary it is "natives" (the DOM calls the
  // host makes, and its own builtins: maps, type tests), under compiled code "compiled", under the page's script "dom".
  const side = (node) => {
    const c = classify(node.callFrame);
    if (c !== "dom" || node.callFrame.url !== "") return c;
    for (let p = parent.get(node.id); p; p = parent.get(p.id)) {
      if (p.callFrame.url === "") continue;
      const pc = classify(p.callFrame);
      return pc === "boundary" ? "natives" : pc === "compiled" ? "compiled" : "dom";
    }
    return "dom";
  };
  const self = { compiled: 0, boundary: 0, natives: 0, dom: 0, gc: 0, layout: 0, other: 0 };
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    const ms = (dt[i + 1] ?? 0) / 1000;
    // A native without a script URL is charged to the nearest scripted frame's side when that is compiled code or the
    // boundary only if the native is the host's own work; DOM natives stay "dom" either way.
    self[side(node)] += ms;
  }
  const busy = self.compiled + self.boundary + self.natives + self.dom + self.gc;
  const pct = (k) => `${k} ${(100 * self[k] / busy).toFixed(0)}%`;
  const script = r.samples.reduce((a, s) => a + s.script, 0) / r.samples.length;
  console.log(`${op.padEnd(11)} script ${script.toFixed(2)} ms/op   ${pct("compiled")}  ${pct("boundary")}  ${pct("natives")}  ${pct("dom")}  ${pct("gc")}`);
  // --top N: the functions with the most self time (a release build keeps names with SCRIPTC_WASMGC_NAMED=1).
  const top = Number(opt("top", 0));
  if (top > 0) {
    const byFn = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const node = byId.get(profile.samples[i]);
      const f = node.callFrame;
      if (f.functionName === "(idle)" || f.functionName === "(program)" || f.functionName === "(root)") continue;
      if (side(node) === "layout") continue;
      const key = `${side(node).padEnd(8)} ${f.functionName || "(anonymous)"} ${f.url.startsWith("wasm://") ? "" : path.basename(f.url)}`;
      byFn.set(key, (byFn.get(key) ?? 0) + (dt[i + 1] ?? 0) / 1000);
    }
    for (const [k, ms] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`    ${(100 * ms / busy).toFixed(1).padStart(5)}%  ${k}`);
  }
}
await browser.close();
server.close();
