#!/usr/bin/env node
// Installs a packed tarball into a clean directory, builds the page programs under test/pages with `scriptw build
// --browser`, and loads each in headless Chromium through the package's exported loader (`scriptw/host`, mapped by an
// import map as a page without a bundler would). Each page's expected document and console lines are in its
// `.expect.json`.
//
//   node npm/wasmgc/test/browser.mjs <package.tgz> [--keep]
//
// Playwright is resolved from the working directory or NODE_PATH; it is not a dependency of the package.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tarball = process.argv[2] && path.resolve(process.argv[2]);
if (!tarball || !fs.existsSync(tarball)) { console.error("usage: browser.mjs <package.tgz> [--keep]"); process.exit(2); }

let chromium;
try {
  ({ chromium } = createRequire(pathToFileURL(path.join(process.cwd(), "noop.js")))("playwright"));
} catch {
  console.error("browser: playwright is not installed (install it in the working directory or put it on NODE_PATH)");
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scriptw-browser-"));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8", ...opts });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
// Serves the install directory: the page, its module and node_modules/scriptw.
const server = http.createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
  res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
  res.end(fs.readFileSync(file));
});

// The page: an import map for `scriptw/host`, then the loader running the module. `window.__hostModules` (set by the
// test before the page's scripts) supplies typed host modules.
const pageHtml = (wasm) => `<!doctype html>
<html><head><meta charset="utf-8"><title>scriptw</title>
<script type="importmap">{ "imports": { "scriptw/host": "/node_modules/scriptw/lib/host.mjs" } }</script>
</head><body>
<script type="module">
import { instantiateWasmGc } from "scriptw/host";
const bytes = new Uint8Array(await (await fetch(${JSON.stringify(wasm)})).arrayBuffer());
const program = await instantiateWasmGc(bytes, { modules: window.__hostModules ?? {} });
await program.main();
</script>
</body></html>
`;

// Typed host modules the pages import, as a page would supply them.
const HOST_MODULES = `window.__hostModules = {
  "host:clock": {
    now: () => 21,
    label: (n) => "#" + n,
    wait: (ms) => new Promise((resolve) => setTimeout(() => resolve("after " + ms), ms)),
  },
};`;

let failures = 0;
let browser;
try {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "browser-smoke", private: true, type: "module" }) + "\n");
  const install = sh("npm", ["install", "--no-audit", "--no-fund", tarball], { shell: process.platform === "win32" });
  if (install.status !== 0) { console.error(install.stdout, install.stderr); process.exit(1); }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  console.log(`chromium ${browser.version()}`);
  const cli = path.join(dir, "node_modules/scriptw/bin/cli.mjs");

  const pagesDir = path.join(here, "pages");
  for (const name of fs.readdirSync(pagesDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).sort()) {
    for (const f of fs.readdirSync(pagesDir)) fs.copyFileSync(path.join(pagesDir, f), path.join(dir, f));
    const stem = name.replace(/\.ts$/, "");
    const expect = JSON.parse(fs.readFileSync(path.join(pagesDir, `${stem}.expect.json`), "utf8"));
    const t = performance.now();
    const build = sh(process.execPath, [cli, "build", name, "--browser", "-o", `${stem}.wasm`]);
    const buildMs = Math.round(performance.now() - t);
    if (build.status !== 0) {
      failures++;
      console.log(`FAIL build ${name}: exit ${build.status}\n${build.stderr}`);
      continue;
    }
    fs.writeFileSync(path.join(dir, `${stem}.html`), pageHtml(`/${stem}.wasm`));

    const page = await browser.newPage();
    const consoleLines = [], errors = [];
    page.on("console", (m) => consoleLines.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(HOST_MODULES);
    await page.goto(`${origin}/${stem}.html`);
    let got;
    try {
      await page.waitForFunction((title) => document.title === title, expect.title, { timeout: 10000 });
      for (const selector of expect.click ?? []) await page.click(selector);
      got = await page.evaluate((selector) => document.querySelector(selector)?.outerHTML ?? null, expect.selector);
    } catch (e) {
      errors.push(String(e.message ?? e).split("\n")[0]);
    }
    const ok = errors.length === 0 && got === expect.html && JSON.stringify(consoleLines) === JSON.stringify(expect.console);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: build ${buildMs} ms, ${fs.statSync(path.join(dir, `${stem}.wasm`)).size} bytes`);
    if (!ok) {
      failures++;
      console.log({ expected: { html: expect.html, console: expect.console }, got: { html: got, console: consoleLines, errors } });
    }
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
  if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
