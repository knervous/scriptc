// @native-any-only: the page bigint is an externref only in the native any model
// bigint arithmetic, comparison, conversion and formatting over page bigints (the typed bigint.* members), spec-exact including the errors.
const a: bigint = 12345678901234567890n, b: bigint = 98765432109876543210n, zero: bigint = 0n, same: bigint = BigInt("12345678901234567890");
console.log(String(a + b), String(b - a), String(a * 3n), String(b / a), String(b % a), String(2n ** 100n), String(-a), String(~a));
console.log(String(a & b), String(a | b), String(a ^ b), String(a << 7n), String(b >> 9n), String(-a >> 3n));
console.log(a < b, a > b, a <= a, a >= b, a === a, a === same, a !== b, a == same);
console.log(a.toString(), a.toString(16), (-255n).toString(2), BigInt(42), BigInt("0x1f"), BigInt(true), BigInt(Number.MAX_SAFE_INTEGER), Number(a), parseInt(String(b)) > 1e19);
console.log(BigInt.asUintN(8, 257n), BigInt.asIntN(8, 255n), BigInt.asUintN(64, -1n), typeof a, typeof (a + 1n), !!zero, !!a);
const errors: string[] = [];
for (const f of [() => 1n / 0n, () => 1n % 0n, () => 2n ** -1n, () => BigInt(1.5), () => BigInt("x")]) {
  try { f(); errors.push("no error"); } catch (e) { errors.push(e instanceof RangeError ? "R" : e instanceof SyntaxError ? "S" : "T"); }
}
console.log(errors.join(","));
let counter = 0n;
for (let i = 0; i < 5; i++) counter += BigInt(i) << 1n;
const sorted: bigint[] = [3n, 1n, 2n];
sorted.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
console.log(counter, sorted.map((v) => String(v)).join(","));
