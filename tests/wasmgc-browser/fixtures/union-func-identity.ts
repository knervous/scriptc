// `u === f` where u is `((...) => R) | undefined` and f a function: identity of the same closure, operands in
// source order. (uniform-copy-batch.ts getUniformCopyBatch `!signature._collectBatches || signature._collectBatches === cached?._collector`.)
type Collector = (n: number) => void;
type Signature = { _collectBatches?: Collector };
const order: string[] = [];
function sig(s: Signature, tag: string): Signature { order.push(tag); return s; }
function fn(c: Collector, tag: string): Collector { order.push(tag); return c; }
const a: Collector = (n) => { order.push("a" + n); };
const b: Collector = (n) => { order.push("b" + n); };
const cached: { _collector?: Collector } | undefined = { _collector: a };
const withA: Signature = { _collectBatches: a }, withB: Signature = { _collectBatches: b }, none: Signature = {};
console.log(withA._collectBatches === cached?._collector!, withB._collectBatches === cached?._collector!, none._collectBatches === a);
console.log(withA._collectBatches !== a, withB._collectBatches !== a, none._collectBatches !== a);
console.log(a === withA._collectBatches, b === withA._collectBatches);
console.log(sig(withA, "u")._collectBatches === fn(a, "f"), fn(a, "f2") === sig(withA, "u2")._collectBatches, order.join(","));
console.log(!withB._collectBatches || withB._collectBatches === cached?._collector!);
