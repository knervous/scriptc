// A tiled image blur, as a job system runs it: a 1024x768 image in 32-row bands, blurred 8 times. Workers claim bands
// from an atomic WorkCounter (the atomics intrinsic library). Here one worker runs on this thread (threads=off).
// lanes.mjs runs the same kernel on worker threads over shared memory (JavaScript, WasmGC threads=shared and native
// thread instances) and through the task ring's owner-thread drain, which must all give the same image. Original
// code, Apache-2.0.
import { WorkCounter } from "../../../packages/intrinsics/atomics.ts";
import { runJobs, testGray, W, H, BANDS } from "./kernel.ts";
import { fnv1a } from "../common/input.ts";

const src = testGray(), dst = new Uint8Array(W * H), tmp = new Uint16Array(W * H);
const cells = new Int32Array(1);
const counter = new WorkCounter(cells, 0, BANDS);
let jobs = 0;
const t0 = performance.now();
for (let r = 0; r < 8; r++) { counter.reset(); jobs += runJobs(src, dst, tmp, counter); }
const ms = performance.now() - t0;
console.log("bands", BANDS, "jobs", jobs, "blurred", fnv1a(dst));
console.log(`time ${ms.toFixed(1)}`);
