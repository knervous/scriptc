// The compiled threads=shared lane under Node: shared.wasm instantiated once on this thread (the image, the counter
// reset and the checksum) and once in each of N worker_threads, every instance importing one shared
// WebAssembly.Memory (shared-layout.mjs). A round resets the counter and lets every worker claim bands until none are
// left; one untimed round starts the workers, as in threads.ts.
//   node shared-run.mjs <shared.wasm> <workers> <compiler dist/backend/wasmgc/host.js URL>
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { args, memoryDescriptor, ROUNDS } from "./shared-layout.mjs";

const [file, count, hostUrl] = isMainThread ? process.argv.slice(2) : workerData.argv;
const { instantiateLinked, linkedCompileOptions } = await import(hostUrl);
// main() runs the module's top-level code (the kernel's constants) before any export is called.
const instance = async (bytes, memory) => {
  const { exports } = (await instantiateLinked(bytes, { blur: {} }, { env: { memory } })).modules.blur;
  if (exports.bytesFree) throw new Error("shared.wasm allocates typed arrays: its heap would overlap the buffers (shared-layout.mjs)");
  exports.main();
  return exports;
};

if (!isMainThread) {
  const blur = await instance(workerData.bytes, workerData.memory);
  parentPort.on("message", () => parentPort.postMessage(blur.work(...args.work)));
  parentPort.postMessage("ready");
} else {
  // Compiled once and posted: the workers share its code (and its tier-up) instead of compiling their own.
  const bytes = await WebAssembly.compile(readFileSync(file), linkedCompileOptions(false)), n = Number(count);
  const memory = new WebAssembly.Memory(memoryDescriptor);
  const blur = await instance(bytes, memory);
  blur.fill(...args.fill);
  const workers = await Promise.all(Array.from({ length: n }, () => new Promise((res) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { argv: [file, count, hostUrl], bytes, memory } });
    w.once("message", () => res(w));
  })));
  const round = () => { blur.reset(...args.reset); return Promise.all(workers.map((w) => new Promise((res) => { w.once("message", res); w.postMessage(0); }))); };
  await round();
  let jobs = 0;
  const t0 = performance.now();
  for (let r = 0; r < ROUNDS; r++) jobs += (await round()).reduce((a, b) => a + b, 0);
  const ms = performance.now() - t0;
  for (const w of workers) await w.terminate();
  console.log("bands", 24, "jobs", jobs, "blurred", blur.checksum(...args.checksum));
  console.log(`time ${ms.toFixed(1)}`);
}
