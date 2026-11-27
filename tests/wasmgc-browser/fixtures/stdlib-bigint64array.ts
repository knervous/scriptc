// @refuse: new BigInt64Array
// @options: {"interfaceClassArms": true}
// new BigInt64Array(buffer) read back as bigint elements.
const buf = new ArrayBuffer(16);
const w = new BigInt64Array(buf);
w[0] = 1_000_000n; w[1] = 3_500_000n;
const a = new BigInt64Array(buf);
console.log(Number(a[1]! - a[0]!) / 1e6, a.length);
