// A tiled image blur, as a job system runs it: a 1024x768 image in 32-row bands, blurred 8 times. This version runs
// the bands in a plain loop. Original code, Apache-2.0.
import { blurBand, testGray, W, H, BANDS } from "./kernel.ts";
import { fnv1a } from "../common/input.ts";

const src = testGray(), dst = new Uint8Array(W * H), tmp = new Uint16Array(W * H);
let jobs = 0;
const t0 = performance.now();
for (let r = 0; r < 8; r++) for (let band = 0; band < BANDS; band++) { blurBand(src, dst, tmp, band); jobs++; }
const ms = performance.now() - t0;
console.log("bands", BANDS, "jobs", jobs, "blurred", fnv1a(dst));
console.log(`time ${ms.toFixed(1)}`);
