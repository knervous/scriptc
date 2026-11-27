// A view written through and never read again still writes its storage: the
// store is observable through every other view of the same buffer.
const base = new Uint8Array(8);
const view = new Uint8Array(base.buffer);
view[0] = 7;
const words = new Uint16Array(base.buffer, 2, 2);
words[1] = 0x0102;
const sub = base.subarray(1, 2);
sub[0] = 9;
const dv = new DataView(base.buffer);
dv.setUint8(7, 5);
console.log(Array.from(base).join(","));
