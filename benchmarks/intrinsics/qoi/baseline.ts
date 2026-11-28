// QOI ("Quite OK Image") encoder and decoder over a generated 512x512 RGBA image: encode, decode, compare, three times.
// Format: the QOI specification by Dominic Szablewski (https://qoiformat.org; reference implementation qoi.h, MIT).
// This port is original code, Apache-2.0.
import { testImage, fnv1a } from "../common/input.ts";

// helpers:begin
const wrap8 = (x: number): number => (x << 24) >> 24;
const hashOf = (r: number, g: number, b: number, a: number): number => (r * 3 + g * 5 + b * 7 + a * 11) & 63;
// helpers:end

const OP_INDEX = 0x00, OP_DIFF = 0x40, OP_LUMA = 0x80, OP_RUN = 0xc0, OP_RGB = 0xfe, OP_RGBA = 0xff;

export function encode(px: Uint8Array, width: number, height: number, out: Uint8Array): number {
  const index = new Uint8Array(256);
  let p = 0;
  const w32 = (v: number) => { out[p++] = (v >>> 24) & 0xff; out[p++] = (v >>> 16) & 0xff; out[p++] = (v >>> 8) & 0xff; out[p++] = v & 0xff; };
  w32(0x716f6966); w32(width); w32(height); out[p++] = 4; out[p++] = 0;
  let pr = 0, pg = 0, pb = 0, pa = 255, run = 0;
  const last = width * height * 4 - 4;
  for (let i = 0; i <= last; i += 4) {
    const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!, a = px[i + 3]!;
    if (r === pr && g === pg && b === pb && a === pa) {
      run++;
      if (run === 62 || i === last) { out[p++] = OP_RUN | (run - 1); run = 0; }
      continue;
    }
    if (run > 0) { out[p++] = OP_RUN | (run - 1); run = 0; }
    const h = hashOf(r, g, b, a) * 4;
    if (index[h] === r && index[h + 1] === g && index[h + 2] === b && index[h + 3] === a) out[p++] = OP_INDEX | (h >> 2);
    else {
      index[h] = r; index[h + 1] = g; index[h + 2] = b; index[h + 3] = a;
      if (a === pa) {
        const vr = wrap8(r - pr), vg = wrap8(g - pg), vb = wrap8(b - pb);
        const vgr = wrap8(vr - vg), vgb = wrap8(vb - vg);
        if (vr > -3 && vr < 2 && vg > -3 && vg < 2 && vb > -3 && vb < 2) out[p++] = OP_DIFF | ((vr + 2) << 4) | ((vg + 2) << 2) | (vb + 2);
        else if (vgr > -9 && vgr < 8 && vg > -33 && vg < 32 && vgb > -9 && vgb < 8) { out[p++] = OP_LUMA | (vg + 32); out[p++] = ((vgr + 8) << 4) | (vgb + 8); }
        else { out[p++] = OP_RGB; out[p++] = r; out[p++] = g; out[p++] = b; }
      } else { out[p++] = OP_RGBA; out[p++] = r; out[p++] = g; out[p++] = b; out[p++] = a; }
    }
    pr = r; pg = g; pb = b; pa = a;
  }
  for (let k = 0; k < 7; k++) out[p++] = 0;
  out[p++] = 1;
  return p;
}

export function decode(data: Uint8Array, size: number, px: Uint8Array): number {
  const index = new Uint8Array(256);
  const width = ((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0;
  const height = ((data[8]! << 24) | (data[9]! << 16) | (data[10]! << 8) | data[11]!) >>> 0;
  let p = 14, r = 0, g = 0, b = 0, a = 255, run = 0;
  const n = width * height * 4, end = size - 8;
  for (let i = 0; i < n; i += 4) {
    if (run > 0) run--;
    else if (p < end) {
      const b1 = data[p++]!;
      if (b1 === OP_RGB) { r = data[p++]!; g = data[p++]!; b = data[p++]!; }
      else if (b1 === OP_RGBA) { r = data[p++]!; g = data[p++]!; b = data[p++]!; a = data[p++]!; }
      else if ((b1 & 0xc0) === OP_INDEX) { const h = b1 * 4; r = index[h]!; g = index[h + 1]!; b = index[h + 2]!; a = index[h + 3]!; }
      else if ((b1 & 0xc0) === OP_DIFF) { r = (r + ((b1 >> 4) & 3) - 2) & 0xff; g = (g + ((b1 >> 2) & 3) - 2) & 0xff; b = (b + (b1 & 3) - 2) & 0xff; }
      else if ((b1 & 0xc0) === OP_LUMA) {
        const b2 = data[p++]!, vg = (b1 & 0x3f) - 32;
        r = (r + vg - 8 + ((b2 >> 4) & 0x0f)) & 0xff; g = (g + vg) & 0xff; b = (b + vg - 8 + (b2 & 0x0f)) & 0xff;
      } else run = b1 & 0x3f;
      const h = hashOf(r, g, b, a) * 4;
      index[h] = r; index[h + 1] = g; index[h + 2] = b; index[h + 3] = a;
    }
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
  return width * height;
}

const W = 512, H = 512;
const image = testImage(W, H, 7);
const encoded = new Uint8Array(W * H * 5 + 22);
const decoded = new Uint8Array(W * H * 4);
let size = 0, same = true;
const t0 = performance.now();
for (let r = 0; r < 3; r++) size = encode(image, W, H, encoded);
const t1 = performance.now();
for (let r = 0; r < 3; r++) decode(encoded, size, decoded);
const t2 = performance.now();
for (let i = 0; i < image.length; i++) if (image[i] !== decoded[i]) { same = false; break; }
console.log("qoi bytes", size, "of", image.length, "encoded", fnv1a(encoded, size), "round trip", same ? "exact" : "DIFFERS");
console.log(`time.encode ${(t1 - t0).toFixed(1)}`);
console.log(`time.decode ${(t2 - t1).toFixed(1)}`);
console.log(`time ${(t2 - t0).toFixed(1)}`);
