// The blur job system's kernel: a separable box blur (radius 3) of one band of rows of a grayscale image, and the
// worker loop that claims bands from a shared counter until none are left. Original code, Apache-2.0.
import { WorkCounter } from "../../../packages/intrinsics/atomics.ts";

export const W = 1024, H = 768, BAND = 32, R = 3;
export const BANDS = H / BAND;

/** Blurs rows [band * BAND, band * BAND + BAND) of src into dst: horizontal then vertical, through tmp (its own rows). */
export function blurBand(src: Uint8Array, dst: Uint8Array, tmp: Uint16Array, band: number): void {
  const y0 = band * BAND;
  // The vertical pass reads R rows above and below the band: blur those horizontally too.
  const from = Math.max(0, y0 - R), to = Math.min(H, y0 + BAND + R);
  for (let y = from; y < to; y++) {
    const row = y * W;
    let sum = 0;
    for (let k = -R; k <= R; k++) sum += src[row + Math.min(W - 1, Math.max(0, k))]!;
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum;
      sum += src[row + Math.min(W - 1, x + R + 1)]! - src[row + Math.max(0, x - R)]!;
    }
  }
  const D = (2 * R + 1) * (2 * R + 1);
  for (let y = y0; y < y0 + BAND; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -R; k <= R; k++) sum += tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x]!;
      dst[y * W + x] = Math.floor(sum / D);
    }
}

/** A worker: claims bands until every band is claimed, and returns how many it blurred. */
export function runJobs(src: Uint8Array, dst: Uint8Array, tmp: Uint16Array, counter: WorkCounter): number {
  let done = 0;
  for (let band = counter.claim(); band >= 0; band = counter.claim()) { blurBand(src, dst, tmp, band); done++; }
  return done;
}

export function testGray(): Uint8Array { return fillGray(new Uint8Array(W * H)); }

/** Writes the test image into img (W * H bytes) and returns it. */
export function fillGray(img: Uint8Array): Uint8Array {
  let s = 12345;
  for (let i = 0; i < img.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) | 0; img[i] = ((i % W) ^ (i / W)) & 0xff ^ (s >>> 28); }
  return img;
}
