#!/usr/bin/env node
// The command line: compile TypeScript or JavaScript to a WasmGC module, or compile and run one under this Node.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { format } from "node:util";

const USAGE = `usage:
  wasmgc build <entry.ts> [-o <out.wasm>] [--target wasmgc] [--release]
  wasmgc run <entry.ts | module.wasm> [--release]

build writes <out.wasm> and its host sidecar <out.wasm.host.json>.
run compiles to a temporary directory (or loads a built module) and runs it here.`;

const argv = process.argv.slice(2);
const command = argv.shift();
if (command === "--version" || command === "-v") {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
if (command !== "build" && command !== "run") {
  console.error(USAGE);
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 2);
}

let entry, out, release = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-o" || a === "--out") out = argv[++i];
  else if (a === "--target") {
    const t = argv[++i];
    if (t !== "wasmgc") { console.error(`wasmgc: unsupported target "${t}" (only wasmgc)`); process.exit(2); }
  } else if (a === "--release") release = true;
  else if (a.startsWith("-")) { console.error(`wasmgc: unknown option ${a}\n${USAGE}`); process.exit(2); }
  else if (entry === undefined) entry = a;
  else { console.error(`wasmgc: unexpected argument ${a}`); process.exit(2); }
}
if (entry === undefined) { console.error(USAGE); process.exit(2); }
entry = path.resolve(entry);
if (!fs.existsSync(entry)) { console.error(`wasmgc: ${entry} does not exist`); process.exit(2); }

const compilerDist = new URL("../packages/compiler/dist/", import.meta.url);

async function build(source, outPath) {
  const { compile } = await import(new URL("index.js", compilerDist));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const r = await compile(source, { outDir: path.dirname(outPath), outPath, outputKind: "wasmgc", release });
  if (!r.ok) {
    for (const d of r.diagnostics) console.error(d.file ? `${d.file}${d.line ? `:${d.line}` : ""}: ${d.message}` : d.message);
    process.exit(1);
  }
  return outPath;
}

async function run(wasmPath) {
  const { instantiateWasmGc } = await import(new URL("backend/wasmgc/host.js", compilerDist));
  const bytes = fs.readFileSync(wasmPath);
  let uncaught = null;
  const m = await instantiateWasmGc(bytes, {
    log: (...v) => process.stdout.write(format(...v) + "\n"),
    error: (...v) => process.stderr.write(format(...v) + "\n"),
    onUncaught: (e) => { uncaught ??= e; },
  });
  let failed = false;
  try {
    const done = m.main();
    if (done && typeof done.then === "function") await done.then(undefined, (e) => { uncaught ??= e; });
    await new Promise((r) => setTimeout(r, 0));
    while (uncaught === null && m.pendingTimers() > 0) await new Promise((r) => setTimeout(r, 2));
  } catch (e) {
    uncaught ??= e;
  } finally {
    m.stopTimers?.();
  }
  if (uncaught !== null) {
    failed = true;
    const shown = uncaught instanceof WebAssembly.Exception ? "Uncaught exception thrown by the program" : uncaught?.stack ?? String(uncaught);
    process.stderr.write(shown + "\n");
  }
  process.exitCode = failed ? 1 : process.exitCode ?? 0;
}

if (command === "build") {
  const target = path.resolve(out ?? entry.replace(/\.(m|c)?[jt]sx?$/, "") + ".wasm");
  await build(entry, target);
  console.error(`wasmgc: wrote ${path.relative(process.cwd(), target) || target}`);
} else if (entry.endsWith(".wasm")) {
  await run(entry);
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wasmgc-run-"));
  try {
    await run(await build(entry, path.join(dir, "main.wasm")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
