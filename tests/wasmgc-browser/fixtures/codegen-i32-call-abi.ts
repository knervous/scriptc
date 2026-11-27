// The i32 call ABI: functions called only directly whose number parameters are proven int32 at every call site
// take i32 parameters, and functions whose every return is proven int32 return i32 (computeI32Abi). Each case
// below must print exactly what Node prints: narrowed chains, sites that must not narrow, and the results.

// Int arguments through several call levels; results used as indexes and in bitwise ops.
function cell(x: number, y: number): number { return (y << 5) | (x & 31); }
function mixCell(h: number, x: number, y: number): number { return Math.imul(h ^ cell(x, y), 16777619) | 0; }
function step(h: number, i: number): number { return mixCell(h, i & 31, (i >> 5) & 31); }
const grid: number[] = [];
for (let i = 0; i < 1024; i++) grid.push((i * 7) % 13);
let h1 = 0;
let sum = 0;
for (let i = 0; i < 1024; i++) { h1 = step(h1 | 0, i); sum += grid[cell(i & 31, (i >> 5) & 31)]!; }
console.log("chain", h1, sum, cell(3, 4) ^ cell(31, 31), cell(1, 2) >>> 1);

// Mixed int and fraction call sites: the parameter must stay a double.
function half(v: number): number { return v / 2; }
function twice(v: number): number { return v * 2; }
console.log("mixed", half(7 | 0), half(2.5), twice(3 | 0), twice(0.25));

// -0 and NaN arguments: must reach the body as themselves.
function sign(v: number): string { return Object.is(v, -0) ? "-0" : Number.isNaN(v) ? "NaN" : String(v); }
function negZero(): number { return -0; }
console.log("zero-nan", sign(0 | 0), sign(-0), sign(negZero()), sign(NaN), sign(1 / 0));
function sameSign(v: number): number { return v | 0; }
console.log("coerced", sameSign(-0), sameSign(NaN), sameSign(2 ** 32 + 5), sameSign(-1.75));

// Overflow past 2^31 in a body: a + b of two int32s is not an int32.
function add(a: number, b: number): number { return a + b; }
function addWrapped(a: number, b: number): number { return (a + b) | 0; }
const big = 2147483647 | 0;
console.log("overflow", add(big, big | 0), addWrapped(big, 1 | 0), add(-2147483648 | 0, -1 | 0), Math.imul(add(big, 1 | 0), 1));

// Unsigned values (>>>) are not int32: 2^32 - 1 must survive.
function ident(v: number): number { return v; }
console.log("unsigned", ident(-1 >>> 0), ident(4294967295 >>> 0) | 0, ident(5 | 0));

// Recursion: int-proven (|0) forms narrow, plain forms do not; both must agree with Node.
function fibI(n: number): number { return n < 2 ? n : (fibI((n - 1) | 0) + fibI((n - 2) | 0)) | 0; }
function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
function gcdI(a: number, b: number): number { return b === 0 ? a : gcdI(b, (a % b) | 0); }
function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
console.log("recursion", fibI(25 | 0), fib(25), fib(10.5), gcdI(1071 | 0, 462 | 0), gcd(1071, 462), gcd(7.5, 2.5));

// A function also used as a value keeps double parameters for its other callers.
function scaleUp(v: number): number { return (v << 1) | 0; }
function apply(f: (v: number) => number, v: number): number { return f(v); }
console.log("value", scaleUp(21 | 0), apply(scaleUp, 2.9), [1.5, 2.5, -0].map(scaleUp).join(","));
function shown(v: number): number { return v; }
const ref = shown;
console.log("value-result", shown(3 | 0), ref(0.5), Object.is(ref(-0), -0));

// A parameter written in the body with a non-int keeps its double.
function written(v: number): number { if (v > 2) v = v / 4; return v | 0; }
function writtenFrac(v: number): number { if (v > 2) v = v / 4; return v; }
console.log("written", written(9 | 0), writtenFrac(9 | 0), writtenFrac(1 | 0));

// Results through try/finally and a conditional return.
function guarded(v: number): number { try { if (v > 3) return (v & 7) | 0; return v ^ 1; } finally { sum ^= 1; } }
console.log("finally", guarded(12 | 0), guarded(2 | 0), sum);

// Optional parameters and a missing argument keep their doubles.
function opt(a: number, b?: number): number { return b === undefined ? a | 0 : (a ^ b) | 0; }
console.log("optional", opt(5 | 0), opt(5 | 0, 3 | 0));

// An async caller and a closure caller of narrowed functions.
async function later(i: number): Promise<number> { return cell(i & 31, 2 | 0) + 0.5; }
const viaClosure = (i: number): number => cell(i | 0, i | 0);
later(7).then((v) => console.log("async", v, viaClosure(3)));
