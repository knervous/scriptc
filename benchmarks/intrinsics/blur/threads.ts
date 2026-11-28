// The blur through the task ring's owner-thread drain (threads=off, createTaskRing from scriptw/host): each band is
// published as a task and drained on this thread, which must give the same image as the workers. Run by lanes.mjs:
// node threads.ts. (The worker-thread lanes are workers.ts and shared.ts.)
import { blurBand, testGray, W, H, BANDS } from "./kernel.ts";
import { fnv1a } from "../common/input.ts";

const src = testGray(), dst = new Uint8Array(W * H), tmp = new Uint16Array(W * H);
let jobs = 0;
const { createTaskRing } = await import(new URL("../../../packages/compiler/dist/backend/wasmgc/task-ring.js", import.meta.url).href);
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
const ms = performance.now() - t0;
ring.stop();
clearInterval(keepAlive);
console.log("bands", BANDS, "jobs", jobs, "blurred", fnv1a(dst));
console.log(`time ${ms.toFixed(1)}`);
