// DataView reads and writes at integer offsets (a `+= 4` induction local) test the bounds in integers: the last
// whole element reads, one byte past it and a negative offset throw Node's RangeError, an offset far past 2^32
// throws rather than wrapping, and fractional offsets still truncate.
const f = new Float32Array([0.5, -0, 1.25, NaN, 3]);
const dv = new DataView(f.buffer);
let s = 0;
for (let o = 0; o < 20; o += 4) { const v = dv.getFloat32(o, true); s += Number.isNaN(v) ? 100 : v; }
console.log(s);
for (let o = 0; o < 20; o += 4) dv.setFloat32(o, o * 0.5, true);
console.log(Array.from(f).join(","));
const tries: string[] = [];
for (let o = 14; o < 20; o += 1) {
  try { tries.push(String(dv.getFloat32(o, true))); } catch (e) { tries.push((e as Error).name); }
}
console.log(tries.join(","));
for (let o = -2; o < 1; o++) {
  try { console.log("neg", o, dv.getUint8(o)); } catch (e) { console.log("neg", o, (e as Error).name); }
}
let far = 2 ** 40;
for (let k = 0; k < 2; k++, far += 4) {
  try { console.log(dv.getFloat32(far, true)); } catch (e) { console.log("far", (e as Error).name); }
  try { dv.setInt16(far, 1, true); console.log("set far"); } catch (e) { console.log("set far", (e as Error).name); }
}
const frac = [0.9, 4.5, -0, 16.99];
for (const o of frac) console.log("frac", o, dv.getFloat32(o, true));
let be = 0;
for (let o = 0; o < 8; o += 2) be += dv.getUint16(o);
console.log(be);
const bytes = new Uint8Array(6);
const bv = new DataView(bytes.buffer, 1, 4);
for (let o = 0; o < 4; o++) bv.setUint8(o, 200 + o);
try { bv.setUint8(4, 1); } catch (e) { console.log("view end", (e as Error).name); }
console.log(bytes.join(","));
export {};
