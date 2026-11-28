// The feature-profile probe: a small module built with
// the backend's own binaryen and optimized by the vendored wasm-opt with the
// backend's exact feature flags, staged with capabilities.html. The page
// executes it in the unflagged browser:
//   - JSPI: a Suspending import under a promising export (delayed result,
//     immediate result, rejection), with the event loop running meanwhile;
//   - shared memory + atomics: an atomic add and notify on an imported
//     shared memory;
//   - bulk memory: memory.fill and memory.copy, then a read back.
//   node build-probe.mjs [stage]   (default .out/coi here; serve it with serve-coi.mjs)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../packages/compiler/dist");
// The backend's own binaryen (resolved from the compiler package).
const { default: binaryen } = await import(pathToFileURL(createRequire(path.join(dist, "index.js")).resolve("binaryen")).href);
const { optimiseWasmGcBinary } = await import(path.join(dist, "backend/wasmgc/emitter.js"));
const stage = path.resolve(process.argv[2] ?? path.join(here, ".out/coi"));
const { i32, none } = binaryen;

const m = new binaryen.Module();
m.setFeatures(binaryen.Features.Atomics | binaryen.Features.BulkMemory | binaryen.Features.BulkMemoryOpt | binaryen.Features.MutableGlobals);
// The environment's shared memory (the deployment shape of the link slice).
m.setMemory(1, 16, null, [], true, false, "0");
m.addMemoryImport("0", "env", "memory");
m.addFunctionImport("wait", "probe", "wait", none, i32);
// run() = wait() + 1: suspends while wait's Promise is pending.
m.addFunction("run", none, i32, [], m.i32.add(m.call("wait", [], i32), m.i32.const(1)));
m.addFunctionExport("run", "run");
// bulk(): fill 64 bytes at 256 with 7, copy them to 512, atomically add 5 to
// the word at 512 and notify it; returns the word (0x07070707 + 5).
m.addFunction("bulk", none, i32, [], m.block(null, [
  m.memory.fill(m.i32.const(256), m.i32.const(7), m.i32.const(64)),
  m.memory.copy(m.i32.const(512), m.i32.const(256), m.i32.const(64)),
  m.drop(m.i32.atomic.rmw.add(0, m.i32.const(512), m.i32.const(5))),
  m.drop(m.memory.atomic.notify(m.i32.const(512), m.i32.const(1))),
  m.i32.atomic.load(0, m.i32.const(512)),
], i32));
m.addFunctionExport("bulk", "bulk");
if (!m.validate()) throw new Error("probe module invalid");
const raw = m.emitBinary();
const opt = optimiseWasmGcBinary(raw);
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, "probe.wasm"), opt);
fs.copyFileSync(path.join(here, "capabilities.html"), path.join(stage, "capabilities.html"));
fs.copyFileSync(path.join(dist, "backend/wasmgc/host.js"), path.join(stage, "host.js"));
console.log(`probe.wasm ${opt.length} bytes (raw ${raw.length})`);
