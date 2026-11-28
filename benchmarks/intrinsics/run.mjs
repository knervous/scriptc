#!/usr/bin/env node
// Runs the intrinsics benchmarks on every lane and writes receipts/<app>.json and RESULTS.md.
//
//   node benchmarks/intrinsics/run.mjs [app ...] [--no-native]
//
// Each app has baseline.ts (plain TypeScript, no intrinsic library) and main.ts (the same work written with the
// intrinsic libraries). Lanes:
//   js           node baseline.ts                    the reference
//   js+fallback  node main.ts                        the libraries' plain-JavaScript bodies
//   wasmgc-base  baseline.ts compiled to WasmGC      what the compiler does without the libraries
//   wasmgc       main.ts compiled to WasmGC          the libraries lowered
//   native-base  baseline.ts compiled natively (LLVM)
//   native       main.ts compiled natively
// A program prints result lines (checksums) and `time...` lines (ms, measured inside the program around the work
// only). Every lane must print the same result lines. An app may add lanes in lanes.mjs (the blur app's threads: see
// blur/lanes.mjs; a lane there may record its runs and the build's resolved capabilities).
// Native lanes need the LLVM helper and runtime pack built for this machine (AGENTS.md, build:native).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const noNative = args.includes("--no-native");
const APPS = ["hash", "qoi", "lz4", "bitset", "physics", "snapshot", "particles", "f16-mesh", "blur"];
const apps = args.filter((a) => !a.startsWith("--"));
const { compile } = await import(pathToFileURL(path.join(repo, "packages/compiler/dist/index.js")).href);
const { instantiateWasmGc } = await import(pathToFileURL(path.join(repo, "packages/compiler/dist/backend/wasmgc/host.js")).href);

const split = (text) => {
  const lines = text.split("\n").filter(Boolean);
  return {
    results: lines.filter((l) => !l.startsWith("time")),
    times: Object.fromEntries(lines.filter((l) => l.startsWith("time")).map((l) => { const [k, v] = l.split(" "); return [k, Number(v)]; })),
  };
};
const runNode = (file) => {
  const r = spawnSync(process.execPath, [file], { encoding: "utf8", cwd: path.dirname(file), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`node ${file} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
};
async function wasmgcLane(file, dir) {
  const outPath = path.join(dir, `${path.basename(file, ".ts")}.wasm`);
  const t = performance.now();
  const r = await compile(file, { outputKind: "wasmgc", outDir: dir, outPath, release: true });
  if (!r.ok) return { error: r.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ").slice(0, 400) };
  const compileMs = performance.now() - t;
  // Run in a child so every lane starts from a fresh engine.
  const runner = path.join(dir, "run-wasm.mjs");
  fs.writeFileSync(runner, `import { instantiateWasmGc } from ${JSON.stringify(pathToFileURL(path.join(repo, "packages/compiler/dist/backend/wasmgc/host.js")).href)};
import { readFileSync } from "node:fs"; import { format } from "node:util";
const m = await instantiateWasmGc(readFileSync(process.argv[2]), { log: (...v) => process.stdout.write(format(...v) + "\\n"), error: (...v) => process.stderr.write(format(...v) + "\\n") });
await m.main(); await new Promise((r) => setTimeout(r, 0)); while (m.pendingTimers() > 0) await new Promise((r) => setTimeout(r, 2)); m.stopTimers();
`);
  const run = spawnSync(process.execPath, [runner, outPath], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (run.status !== 0) return { error: `run exited ${run.status}: ${run.stderr.slice(0, 400)}` };
  return { stdout: run.stdout, bytes: fs.statSync(outPath).size, compileMs };
}
async function nativeLane(file, dir) {
  const outPath = path.join(dir, path.basename(file, ".ts"));
  const t = performance.now();
  const r = await compile(file, { outputKind: "exe", backend: "llvm", outDir: dir, outPath });
  if (!r.ok) return { error: r.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ").slice(0, 400) };
  const compileMs = performance.now() - t;
  const run = spawnSync(outPath, [], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (run.status !== 0) return { error: `run exited ${run.status}: ${run.stderr.slice(0, 400)}` };
  return { stdout: run.stdout, bytes: fs.statSync(outPath).size, compileMs };
}

const receipts = [];
for (const app of apps.length ? apps : APPS) {
  const dir = path.join(here, app);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `intrinsics-${app}-`));
  const lanes = {};
  const base = path.join(dir, "baseline.ts"), main = path.join(dir, "main.ts");
  lanes["js"] = { stdout: runNode(base) };
  lanes["js+fallback"] = { stdout: runNode(main) };
  lanes["wasmgc-base"] = await wasmgcLane(base, work);
  lanes["wasmgc"] = await wasmgcLane(main, work);
  if (!noNative) {
    lanes["native-base"] = await nativeLane(base, work);
    lanes["native"] = await nativeLane(main, work);
  }
  const extra = path.join(dir, "lanes.mjs");
  if (fs.existsSync(extra)) Object.assign(lanes, await (await import(pathToFileURL(extra).href)).default({ repo, dir, noNative }));
  const ref = split(lanes["js"].stdout).results;
  const receipt = { app, node: process.version, platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, date: new Date().toISOString(), results: ref, lanes: {} };
  for (const [name, lane] of Object.entries(lanes)) {
    if (lane.error) { receipt.lanes[name] = { error: lane.error }; continue; }
    const { results, times } = split(lane.stdout);
    receipt.lanes[name] = {
      match: JSON.stringify(results) === JSON.stringify(ref),
      ...(JSON.stringify(results) === JSON.stringify(ref) ? {} : { results }),
      times, ...(lane.bytes ? { bytes: lane.bytes } : {}), ...(lane.compileMs ? { compileMs: Math.round(lane.compileMs) } : {}),
      ...(lane.note ? { note: lane.note } : {}), ...(lane.runs ? { runs: lane.runs } : {}),
      ...(lane.capabilities ? { capabilities: lane.capabilities, explainCapabilities: lane.explainCapabilities } : {}),
    };
  }
  fs.writeFileSync(path.join(here, "receipts", `${app}.json`), JSON.stringify(receipt, null, 2) + "\n");
  receipts.push(receipt);
  fs.rmSync(work, { recursive: true, force: true });
  const line = Object.entries(receipt.lanes).map(([n, l]) => l.error ? `${n}: ERROR` : `${n} ${l.times.time ?? "?"}ms${l.match ? "" : " MISMATCH"}`).join(" | ");
  console.log(`${app}: ${line}`);
}
void instantiateWasmGc; void format;
