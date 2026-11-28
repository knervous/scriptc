// The blur on N worker threads over shared memory (threads=shared): node:worker_threads with SharedArrayBuffers, bands
// claimed from a WorkCounter. This is the JavaScript lane. (The native threads lane is shared.ts with native-host.c:
// the native frontend does not lower worker_threads yet.) One untimed round starts the workers.
//   node workers.ts [workers]   (default 4)
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { WorkCounter } from "../../../packages/intrinsics/atomics.ts";
import { runJobs, fillGray, W, H, BANDS } from "./kernel.ts";
import { fnv1a } from "../common/input.ts";

interface Shared { src: SharedArrayBuffer; dst: SharedArrayBuffer; tmp: SharedArrayBuffer; cells: SharedArrayBuffer }

if (!isMainThread) {
  const { src, dst, tmp, cells } = workerData as Shared;
  const s = new Uint8Array(src), d = new Uint8Array(dst), t = new Uint16Array(tmp);
  const counter = new WorkCounter(new Int32Array(cells), 0, BANDS);
  parentPort!.on("message", () => { parentPort!.postMessage(runJobs(s, d, t, counter)); });
} else {
  const n = Number(process.argv[2] ?? "4");
  const shared: Shared = { src: new SharedArrayBuffer(W * H), dst: new SharedArrayBuffer(W * H), tmp: new SharedArrayBuffer(W * H * 2), cells: new SharedArrayBuffer(4) };
  fillGray(new Uint8Array(shared.src));
  const dst = new Uint8Array(shared.dst);
  const counter = new WorkCounter(new Int32Array(shared.cells), 0, BANDS);
  const workers: Worker[] = [];
  for (let i = 0; i < n; i++) workers.push(new Worker(new URL(import.meta.url), { workerData: shared }));
  const round = (): Promise<number> => {
    counter.reset();
    let left = workers.length, jobs = 0;
    return new Promise<number>((resolve) => {
      for (const w of workers) {
        w.once("message", (done: number) => { jobs += done; if (--left === 0) resolve(jobs); });
        w.postMessage(0);
      }
    });
  };
  round().then(async () => {
    let jobs = 0;
    const t0 = performance.now();
    for (let r = 0; r < 8; r++) jobs += await round();
    const ms = performance.now() - t0;
    for (const w of workers) await w.terminate();
    console.log("bands", BANDS, "jobs", jobs, "blurred", fnv1a(dst));
    console.log(`time ${ms.toFixed(1)}`);
  });
}
