// @native-only: the engine dyn model keeps its fence for DataView 64-bit setters
// DataView.setBigInt64 / setBigUint64: values, signs, wrap-around, both endiannesses, and the bounds RangeError.
const dv = new DataView(new ArrayBuffer(24));
dv.setBigInt64(0, -2n, true);
dv.setBigInt64(8, 0x0102030405060708n, false);
dv.setBigUint64(16, 0xfffffffffffffffen, true);
const bytes = new Uint8Array(dv.buffer);
console.log(Array.from(bytes).join(","));
console.log(dv.getBigInt64(0, true), dv.getBigUint64(0, true), dv.getBigInt64(8, false), dv.getBigInt64(8, true), dv.getBigInt64(16, true));
dv.setBigInt64(0, 2n ** 64n + 5n, true);
console.log(dv.getBigInt64(0, true));
dv.setBigUint64(0, -1n, true);
console.log(dv.getBigUint64(0, true));
try { dv.setBigInt64(17, 1n); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { dv.setBigInt64(-1, 1n); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
