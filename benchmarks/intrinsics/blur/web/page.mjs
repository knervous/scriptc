// The compiled threads=shared blur in a cross-origin-isolated page (browser-run.mjs serves it): the page's own
// instance fills the image, resets the counter and checksums, and N module Workers each instantiate the same compiled
// module on the same shared memory (shared-layout.mjs). Reports through window.__result.
import { instantiateLinked, linkedCompileOptions } from "/dist/backend/wasmgc/host.js";
import { args, memoryDescriptor, ROUNDS } from "/blur/shared-layout.mjs";

const run = async () => {
  if (!crossOriginIsolated) throw new Error("the page is not cross-origin isolated");
  const n = Number(new URLSearchParams(location.search).get("workers") ?? 4);
  const module = await WebAssembly.compileStreaming(fetch("/out/shared.wasm"), linkedCompileOptions(false));
  const memory = new WebAssembly.Memory(memoryDescriptor);
  const linked = await instantiateLinked(module, { blur: {} }, { env: { memory } });
  await linked.modules.blur.main();
  const blur = linked.modules.blur.exports;
  blur.fill(...args.fill);
  const workers = await Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL("worker.mjs", import.meta.url), { type: "module" });
    w.onerror = (e) => reject(new Error(`worker: ${e.message}`));
    w.onmessage = ({ data }) => (data === "ready" ? resolve(w) : reject(new Error(String(data?.error ?? data))));
    w.postMessage({ module, memory });
  })));
  const round = () => {
    blur.reset(...args.reset);
    return Promise.all(workers.map((w) => new Promise((resolve) => { w.onmessage = ({ data }) => resolve(data); w.postMessage(0); })));
  };
  await round();
  let jobs = 0;
  const t0 = performance.now();
  for (let r = 0; r < ROUNDS; r++) jobs += (await round()).reduce((a, b) => a + b, 0);
  const ms = performance.now() - t0;
  for (const w of workers) w.terminate();
  return { stdout: `bands 24 jobs ${jobs} blurred ${blur.checksum(...args.checksum)}\ntime ${ms.toFixed(1)}\n`, cores: navigator.hardwareConcurrency };
};
run().then((r) => { window.__result = r; }, (e) => { window.__result = { error: String(e?.stack ?? e) }; });
