// The blur on four worker threads over shared memory (threads=shared), or through the task ring's owner-thread drain
// (threads=off, createTaskRing from scriptw/host). Run by lanes.mjs: node threads.ts shared|ring
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { WorkCounter } from "../../../packages/intrinsics/atomics.ts";
import { blurBand, runJobs, testGray, W, H, BANDS } from "./kernel.ts";
import { fnv1a } from "../common/input.ts";

if (!isMainThread) {
  const { src, dst, tmp, cells } = workerData as { src: SharedArrayBuffer; dst: SharedArrayBuffer; tmp: SharedArrayBuffer; cells: SharedArrayBuffer };
  const counter = new WorkCounter(new Int32Array(cells), 0, BANDS);
  parentPort!.on("message", () => parentPort!.postMessage(runJobs(new Uint8Array(src), new Uint8Array(dst), new Uint16Array(tmp), counter)));
} else {
  const mode = process.argv[2] ?? "shared";
  const share = (n: number) => new SharedArrayBuffer(n);
  const srcBuf = share(W * H), dstBuf = share(W * H), tmpBuf = share(W * H * 2), cellsBuf = share(4);
  new Uint8Array(srcBuf).set(testGray());
  const dst = new Uint8Array(dstBuf);
  let jobs = 0;
  let ms = 0;
  if (mode === "shared") {
    const workers = Array.from({ length: 4 }, () => new Worker(new URL(import.meta.url), { workerData: { src: srcBuf, dst: dstBuf, tmp: tmpBuf, cells: cellsBuf } }));
    const counter = new WorkCounter(new Int32Array(cellsBuf), 0, BANDS);
    // One untimed round starts the workers.
    const round = () => Promise.all(workers.map((w) => new Promise<number>((res) => { w.once("message", res); w.postMessage(0); })));
    counter.reset(); await round();
    const t0 = performance.now();
    for (let r = 0; r < 8; r++) { counter.reset(); jobs += (await round()).reduce((a, b) => a + b, 0); }
    ms = performance.now() - t0;
    for (const w of workers) await w.terminate();
  } else {
    const { createTaskRing } = await import(new URL("../../../packages/compiler/dist/backend/wasmgc/task-ring.js", import.meta.url).href);
    const src = new Uint8Array(srcBuf), tmp = new Uint16Array(tmpBuf);
    const ring = createTaskRing({ threads: "off", slots: 32, payloadBytes: 16, run: (_entry: number, payload: Uint8Array) => { blurBand(src, dst, tmp, payload[0]!); return { status: 0, result: 1 }; } });
    // The ring's drain port does not keep Node alive by itself (task-ring.ts): the caller holds the loop open.
    const keepAlive = setInterval(() => {}, 1000);
    const t0 = performance.now();
    for (let r = 0; r < 8; r++)
      for (let band = 0; band < BANDS; band++) {
        const slot = ring.claim();
        ring.payload(slot)[0] = band;
        const seen = ring.completed();
        ring.publish(slot, 1, 1, 1);
        await ring.waitForCompletion(seen);
        ring.reap((_id: number, _status: number, result: number) => { jobs += result; });
      }
    ms = performance.now() - t0;
    ring.stop();
    clearInterval(keepAlive);
  }
  console.log("bands", BANDS, "jobs", jobs, "blurred", fnv1a(dst));
  console.log(`time ${ms.toFixed(1)}`);
}
