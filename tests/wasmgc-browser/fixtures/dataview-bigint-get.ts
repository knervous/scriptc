// DataView.getBigUint64 / getBigInt64 (gpu-timer.ts reads GPU timestamp pairs): 64 bits, either endianness,
// signed and unsigned, RangeError past the end, NaN offset as 0.
const dv = new DataView(new ArrayBuffer(24));
dv.setUint32(0, 0xffffffff, true); dv.setUint32(4, 0xffffffff, true);
dv.setUint32(8, 0x01020304, false); dv.setUint32(12, 0x05060708, false);
dv.setUint32(16, 1000, true);
console.log(String(dv.getBigUint64(0, true)), String(dv.getBigInt64(0, true)), String(dv.getBigUint64(8)), String(dv.getBigUint64(8, true)));
const start = dv.getBigUint64(16, true), end = dv.getBigUint64(16, true) + 2500n;
console.log(String(end - start), Number(end - start) / 1e6, String(dv.getBigInt64(NaN, true)));
try { dv.getBigUint64(20, true); } catch (e) { console.log((e as Error).name, (e as Error).message); }
