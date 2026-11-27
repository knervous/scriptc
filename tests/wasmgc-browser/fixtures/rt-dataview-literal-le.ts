// DataView reads and writes of a byte, or with a literal `true` byte order, compile inline (10-29: every generated record view's field
// read called a `$dv.get.*` helper, and release's -O1 inlines nothing). Unaligned offsets, a view with a byte offset,
// the RangeError bounds, ToIndex on the offset, ToInt32 and f32 rounding on stores, NaN against the bit pattern the
// compiled build reserves for undefined, and -0 must all read as Node reads them; the other orders keep the helper.
const bytes = new Uint8Array(40);
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 255;
const dv = new DataView(bytes.buffer, 3, 32);
console.log("get", dv.getUint8(1), dv.getInt8(2), dv.getUint16(1, true), dv.getInt16(3, true), dv.getUint32(1, true), dv.getInt32(5, true));
console.log("float", dv.getFloat32(9, true), dv.getFloat64(13, true));
console.log("order", dv.getUint32(1, true) === dv.getUint32(1, false), dv.getUint16(7, true), dv.getUint16(7, false), dv.getUint16(7));

dv.setUint32(1, 0xdeadbeef, true);
dv.setInt16(6, -2, true);
dv.setUint8(8, 300);
dv.setInt8(9, -129);
dv.setInt32(10, 2 ** 32 + 5, true);
dv.setUint16(14, -1, true);
console.log("set", dv.getUint32(1, true), dv.getUint32(1, false), dv.getInt16(6, true), dv.getUint8(8), dv.getInt8(9), dv.getInt32(10, true), dv.getUint16(14, true));
console.log("bytes", Array.from(bytes.subarray(3, 20)).join(","));

dv.setFloat32(17, 0.1, true);
dv.setFloat64(21, -0, true);
console.log("f32", dv.getFloat32(17, true), dv.getFloat32(17, false) === dv.getFloat32(17, true), Object.is(dv.getFloat64(21, true), -0));
dv.setFloat64(21, NaN, true);
console.log("nan", Number.isNaN(dv.getFloat64(21, true)), typeof dv.getFloat64(21, true));
dv.setUint32(21, 0x00000001, true);
dv.setUint32(25, 0x7ff40000, true);
const undefBits = dv.getFloat64(21, true);
console.log("undef bits", Number.isNaN(undefBits), typeof undefBits, undefBits === undefined, String(undefBits));

console.log("index", dv.getUint8(NaN) === dv.getUint8(0), dv.getUint16(1.9, true) === dv.getUint16(1, true));
const tryRead = (label: string, f: () => number) => {
  try { console.log(label, f()); } catch (e) { console.log(label, e instanceof RangeError, (e as Error).message); }
};
tryRead("end", () => dv.getUint32(28, true));
tryRead("straddle", () => dv.getUint32(29, true));
tryRead("negative", () => dv.getFloat64(-1, true));
tryRead("past", () => dv.getUint8(32));
tryRead("set past", () => { dv.setInt8(32, 1); return 0; });
tryRead("set straddle", () => { dv.setFloat64(25, 1, true); return 0; });
tryRead("set negative", () => { dv.setUint16(-2, 1, true); return 0; });

let sum = 0;
for (let at = 0; at + 4 <= 32; at += 3) sum += dv.getUint32(at, true) % 1000 + dv.getFloat32(at, true) * 0;
console.log("loop", sum);
