// Typed-array bulk paths (fill, cross-kind set and construction) across every
// element kind, length and alignment the vector kernels split into: the
// vector body, the scalar tail, unaligned views and overlapping buffers.
const vals = [0, 1, -1, 127, 128, 255, 256, -129, -128, 32767, 32768, 65535, 65536, -32769, 2147483647, 2147483648, 4294967295, 4294967296, -2147483649,
  0.5, 1.5, 2.5, -0.5, -1.5, 254.5, 255.5, 1e10, -1e10, NaN, Infinity, -Infinity, -0, 3.4e38, 1e-45, 16777217, 16777219, 2 ** 53 + 2, -7.25];
function sig(a: number[]): string {
  let h = 0, negz = 0;
  for (let i = 0; i < a.length; i++) { const s = String(a[i]); for (let j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) | 0; h = (h * 7 + 44) | 0; if (Object.is(a[i], -0)) negz++; }
  return a.length + ":" + h + ":" + negz + ":" + a.slice(0, 5).join(",");
}
const lens = [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 33, 41];
let out = "";
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 0) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint8ClampedArray(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 1) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint8Clamped>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int8Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 2) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int8>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 3) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint16>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int16Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 4) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int16>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Uint32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 5) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Uint32>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Int32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 6) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Int32>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float32Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 7) % vals.length];
  const a = new Float64Array(src); const b = new Float64Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float32>Float64 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Uint8Array(src); const b = new Uint8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Uint8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Uint8ClampedArray(src); const b = new Uint8ClampedArray(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Uint8Clamped " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Int8Array(src); const b = new Int8Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Int8 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Uint16Array(src); const b = new Uint16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Uint16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Int16Array(src); const b = new Int16Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Int16 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Uint32Array(src); const b = new Uint32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Uint32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Int32Array(src); const b = new Int32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Int32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of lens) {
  const src = new Float64Array(n + 3); for (let i = 0; i < src.length; i++) src[i] = vals[(i * 5 + 8) % vals.length];
  const a = new Float32Array(src); const b = new Float32Array(n + 4); b.set(src.subarray(1, n + 1), 2);
  out += "Float64>Float32 " + n + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + "\n";
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Uint8Array(n + 2); a.fill(v); const b = new Uint8Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Uint8Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Uint8 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Uint8ClampedArray(n + 2); a.fill(v); const b = new Uint8ClampedArray(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Uint8ClampedArray(n + 2); c.fill(v, -n, n + 1);
    out += "fill Uint8Clamped " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Int8Array(n + 2); a.fill(v); const b = new Int8Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Int8Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Int8 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Uint16Array(n + 2); a.fill(v); const b = new Uint16Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Uint16Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Uint16 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Int16Array(n + 2); a.fill(v); const b = new Int16Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Int16Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Int16 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Uint32Array(n + 2); a.fill(v); const b = new Uint32Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Uint32Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Uint32 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Int32Array(n + 2); a.fill(v); const b = new Int32Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Int32Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Int32 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Float32Array(n + 2); a.fill(v); const b = new Float32Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Float32Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Float32 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
for (const n of [0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 31, 33, 63, 64, 65, 100]) {
  for (const v of [0, 1, -1, 300, -300, 65537, -0, NaN, Infinity, 2.5, 254.5, 255.5, -0.75, 1e10, 4294967295, 3.4e38, 1e-45]) {
    const a = new Float64Array(n + 2); a.fill(v); const b = new Float64Array(n + 2); b.subarray(1).fill(v, 1, -1); const c = new Float64Array(n + 2); c.fill(v, -n, n + 1);
    out += "fill Float64 " + n + " " + v + " " + sig(Array.from(a)) + " " + sig(Array.from(b)) + " " + sig(Array.from(c)) + "\n";
  }
}
const raw = new Uint8Array(96); for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + 11) & 255;
{ const r = raw.slice(); const dv = new Uint16Array(r.buffer, 0, 6); const sv = new Uint8Array(r.buffer, 0, 6); dv.set(sv); out += "overlap 0 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Uint16Array(r.buffer, 0, 6); const sv = new Uint8Array(r.buffer, 8, 6); dv.set(sv); out += "overlap 1 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Float32Array(r.buffer, 0, 6); const sv = new Uint8Array(r.buffer, 4, 6); dv.set(sv); out += "overlap 2 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Float32Array(r.buffer, 8, 6); const sv = new Int16Array(r.buffer, 0, 6); dv.set(sv); out += "overlap 3 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Float64Array(r.buffer, 0, 6); const sv = new Float32Array(r.buffer, 32, 6); dv.set(sv); out += "overlap 4 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Float32Array(r.buffer, 8, 6); const sv = new Float64Array(r.buffer, 0, 6); dv.set(sv); out += "overlap 5 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Uint8Array(r.buffer, 3, 6); const sv = new Uint32Array(r.buffer, 0, 6); dv.set(sv); out += "overlap 6 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Int32Array(r.buffer, 16, 6); const sv = new Int8Array(r.buffer, 2, 6); dv.set(sv); out += "overlap 7 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
{ const r = raw.slice(); const dv = new Uint8Array(r.buffer, 0, 6); const sv = new Float64Array(r.buffer, 0, 6); dv.set(sv); out += "overlap 8 " + sig(Array.from(dv)) + " " + sig(Array.from(r)) + "\n"; }
console.log(out);
