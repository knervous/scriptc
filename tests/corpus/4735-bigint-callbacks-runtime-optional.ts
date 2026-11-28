// A function reached from an array method's callback takes its parameter as the callback received it, which the
// compiler treats as possibly undefined (an unchecked element read). Bigint comparisons and arithmetic over such a
// parameter compile and run as over a bigint, in `.map`, `.filter`, `.some` and `.reduce` callbacks, and beside loops.
function sq(b: bigint): bigint { return b === 0n ? 1n : b * b; }
function sign(b: bigint): string { return b < 0n ? "neg" : b > 0n ? "pos" : b !== 0n ? "?" : "zero"; }
function mix(a: bigint, b: bigint): bigint { return (a + b) * (a - b) / 2n % 1000n ^ (a & b) | (a << 2n) >> 1n; }
function same(a: bigint, b: bigint): boolean { return a == b && !(a != b) && a <= b && a >= b; }
const big: bigint[] = [0n, 3n, -4n, 12345678901234567890n];
console.log(big.map((b) => sq(b)).map((b) => b.toString()).join(","));
console.log(big.map((b) => sign(b)).join(","));
console.log(big.filter((b) => sq(b) > 9n).length, big.some((b) => same(b, 3n)), big.every((b) => sign(b) !== "?"));
console.log(big.reduce((acc, b) => acc + mix(b, 7n), 0n).toString());
let total = 0n;
for (const b of big) total += sq(b) + mix(b, 1n);
console.log(total.toString(), sq(5n).toString(), sign(-1n), same(2n, 2n));
// `findIndex` visits holes, so the callback's element can really be undefined: comparisons answer as JavaScript's do.
const holes: bigint[] = [];
holes[2] = 5n;
console.log(holes.findIndex((b) => sign(b) === "?"), holes.findIndex((b) => same(b, 5n)), holes.findIndex((b) => b === undefined));
