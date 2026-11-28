// The browser lanes (docs/capabilities.md §4.6): web/probe.js in a headless browser under each configuration, with
// and without cross-origin isolation, and with JS-API entry points deleted before any page script runs. Exits 1 when
// any lane fails.
//
// usage: node tests/capabilities/chromium.mjs [--browser=chromium|firefox|webkit] [--executable=<path>] ['<configs JSON>']
//   (after build.mjs and lane.mjs --update; Playwright resolvable from here or through NODE_PATH)
//   --executable: a pinned browser build (an older Chrome for Testing) in place of Playwright's.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "../../packages/compiler/dist");
const playwright = createRequire(import.meta.url)("playwright");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserType = playwright[arg("browser") ?? "chromium"];
const executablePath = arg("executable");
const types = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json" };
const serve = (coi) => http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const file = p.startsWith("/dist/") ? path.join(DIST, p.slice(6)) : p.startsWith("/out/") || p === "/expected.json" ? path.join(here, p) : path.join(here, "web", p === "/" ? "index.html" : p);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const headers = { "content-type": types[path.extname(file)] ?? "application/octet-stream" };
  if (coi) Object.assign(headers, { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(0);
const plain = serve(false), isolated = serve(true);
await Promise.all([plain, isolated].map(s => new Promise(r => s.once("listening", r))));
const MODS = fs.readdirSync(path.join(here, "out")).filter(f => f.endsWith(".wasm")).sort().join(",");
const configs = JSON.parse(process.argv.find((a) => a.startsWith("[")) ?? "null") ?? [
  { name: "default", coi: false },
  { name: "cross-origin isolated", coi: true },
  { name: "JS API deleted: toResizableBuffer, Suspending/promising, Atomics.waitAsync, SharedArrayBuffer", coi: true,
    init: "delete WebAssembly.Memory.prototype.toResizableBuffer; delete WebAssembly.Suspending; delete WebAssembly.promising; delete Atomics.waitAsync; delete globalThis.SharedArrayBuffer;" },
];
const report = [];
let failures = 0;
for (const c of configs) {
  const browser = await browserType.launch({ ...(executablePath ? { executablePath } : {}), ...(c.flags ? { args: [`--js-flags=${c.flags}`] } : {}) });
  const page = await browser.newPage();
  if (c.init) await page.addInitScript(c.init);
  const port = (c.coi ? isolated : plain).address().port;
  await page.goto(`http://localhost:${port}/?mods=${MODS}`);
  const r = await page.waitForFunction(() => window.__result, null, { timeout: 120000 }).then(h => h.jsonValue()).catch(e => ({ error: String(e), failures: 1, rows: [] }));
  failures += r.failures;
  report.push({ config: c.name, browser: `${arg("browser") ?? "chromium"} ${browser.version()}`, ...r });
  await browser.close();
}
// The task ring: threaded where the page can share memory, on the owner's thread elsewhere, with one log.
const rings = report.filter((r) => r.ring && !r.ring.error);
for (const r of rings) {
  const expect = r.engine["shared-memory"] && r.engine["cross-origin-isolation"] ? "shared" : "off";
  if (r.ring.threads !== expect || r.ring.consumerState !== 2) { failures++; r.ring.verdict = `FAIL: threads=${r.ring.threads}, expected ${expect}; consumer state ${r.ring.consumerState}`; }
  else if (JSON.stringify(r.ring.log) !== JSON.stringify(rings[0].ring.log)) { failures++; r.ring.verdict = "FAIL: the ring's log differs from the first configuration's"; }
  else r.ring.verdict = `ok (threads=${r.ring.threads}, ${r.ring.log.length} events, same log)`;
}
for (const r of report) {
  console.log(`## ${r.config} (${r.browser})`);
  if (r.ring) console.log(`  task ring: ${r.ring.error ? `FAIL: ${r.ring.error}` : r.ring.verdict}`);
  if (r.error) console.log(`  FAIL: ${r.error}`);
  else {
    console.log(`  engine lacks: ${Object.entries(r.engine).filter(([, v]) => !v).map(([k]) => k).join(", ") || "nothing"}`);
    for (const row of r.rows) console.log(`  ${row}`);
  }
}
console.log(failures ? `browser lanes: ${failures} failure(s)` : "browser lanes: every mode agrees");
plain.close();
isolated.close();
process.exitCode = failures ? 1 : 0;
