// One CI lane of the capability matrix (docs/capabilities.md §4.6): every probe module under every strings mode on
// this engine. A module whose recorded requirements this engine meets must print exactly its golden output
// (expected.json) in every mode; one it does not meet must be refused, naming what is missing. The same goldens hold
// on every lane, so identical output across modes and engines is the check.
//
// usage: node [v8 flags] tests/capabilities/lane.mjs [--update]   (after build.mjs)
//   --update rewrites expected.json from this engine's runs (only modes that ran).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const host = await import(path.join(root, "packages/compiler/dist/backend/wasmgc/host.js"));
const caps = await import(path.join(root, "packages/compiler/dist/backend/wasmgc/capabilities.js"));
const goldenPath = path.join(here, "expected.json");
const golden = fs.existsSync(goldenPath) ? JSON.parse(fs.readFileSync(goldenPath, "utf8")) : {};
const update = process.argv.includes("--update");
const MODES = ["auto", "engine", "constants", "polyfill"];
globalThis.sink = (u8) => `len=${u8.length} first=${u8[0]}`;

const engine = caps.detectCapabilities();
console.log(`lane: Node ${process.version}, flags [${process.execArgv.join(" ")}]`);
console.log(`lane: engine ${Object.entries(engine).filter(([, v]) => !v).map(([k]) => `-${k}`).join(" ") || "(everything)"}`);

async function runOnce(bytes, strings) {
  const out = [];
  const push = (...a) => out.push(format(...a));
  const inst = await host.instantiateWasmGc(bytes, { log: push, error: push, strings });
  const pageLog = console.log, pageError = console.error;
  console.log = push; console.error = push;
  try { await inst.main(); await new Promise((r) => setTimeout(r, 5)); } finally { console.log = pageLog; console.error = pageError; inst.stopTimers(); }
  return { out: out.join("\n"), fallbacks: inst.capabilities.fallbacks };
}

const out = path.join(here, "out");
const modules = fs.readdirSync(out).filter((f) => f.endsWith(".wasm")).sort();
if (!modules.length) { console.error("lane: no modules; run tests/capabilities/build.mjs first"); process.exit(2); }
let failures = 0;
for (const file of modules) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(out, file)));
  const required = host.requiredCapabilities(bytes);
  for (const strings of MODES) {
    // Under strings=engine the string capabilities are hard requirements too.
    const hard = (required?.requires ?? []).filter((r) => strings === "engine" || !caps.SOFT_REQUIREMENTS.has(r));
    const missing = hard.filter((r) => !engine[r]);
    let verdict;
    try {
      const r = await runOnce(bytes, strings);
      if (missing.length) verdict = `FAIL: ran, but this engine lacks ${missing.join(", ")}`;
      else if (update) { golden[file] = r.out; verdict = `ok (recorded)${r.fallbacks.length ? ` [${r.fallbacks.join(", ")}]` : ""}`; }
      else if (golden[file] === undefined) verdict = "FAIL: no golden output (run with --update on a capable engine)";
      else if (r.out !== golden[file]) verdict = `FAIL: output differs\n--- expected\n${golden[file]}\n--- got\n${r.out}`;
      else verdict = `ok${r.fallbacks.length ? ` [${r.fallbacks.join(", ")}]` : ""}`;
    } catch (e) {
      const message = String(e?.message ?? e);
      verdict = missing.length && /this module requires|this host lacks|this engine lacks/.test(message)
        ? `refused (${missing.join(", ")})` : `FAIL: ${message.slice(0, 300)}`;
    }
    if (verdict.startsWith("FAIL")) failures++;
    console.log(`${file.padEnd(28)} ${strings.padEnd(9)} ${verdict}`);
  }
}
if (update) fs.writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
console.log(failures ? `lane: ${failures} failure(s)` : "lane: every mode agrees");
process.exitCode = failures ? 1 : 0;
