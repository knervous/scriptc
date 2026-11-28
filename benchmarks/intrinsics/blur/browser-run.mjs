// The compiled threads=shared lane in headless Chromium: serves web/ cross-origin isolated (COOP same-origin, COEP
// require-corp) and runs the page with N workers in a fresh browser. Prints the page's result lines, and the browser
// version on stderr.
//   node browser-run.mjs <dir holding shared.wasm> <workers> <compiler dist dir>
// Playwright must be resolvable from here or through NODE_PATH.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [outDir, workers, dist] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)("playwright");
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm" };
const roots = { "/dist/": dist, "/out/": outDir, "/blur/": here, "/": path.join(here, "web") };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const prefix = Object.keys(roots).find((k) => p.startsWith(k));
  const file = path.join(roots[prefix], p.slice(prefix.length) || "index.html");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream",
    "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(`page: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/?workers=${workers}`);
  const r = await page.waitForFunction(() => window.__result, null, { timeout: 120000 }).then((h) => h.jsonValue());
  if (r.error) { console.error(r.error); process.exitCode = 1; }
  else { process.stdout.write(r.stdout); process.stderr.write(`chromium ${browser.version()}, navigator.hardwareConcurrency ${r.cores}\n`); }
} finally { await browser.close(); server.close(); }
