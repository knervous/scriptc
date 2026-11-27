// Number(x) over values the compiler holds dynamically (an `unknown`, a union of primitives), synchronously and after an
// `await`: primitives convert by ToNumber, an array through its join, any other object to NaN.
function plusOne(x: unknown): number {
  return Number(x) + 1;
}
console.log(plusOne("41"), plusOne(true), plusOne(null), plusOne(undefined), plusOne(" 0x10 "), plusOne(""));
console.log(plusOne([5]), plusOne([]), plusOne([1, 2]), plusOne({}), plusOne("1e3"), plusOne("-0"));
function scaled(x: string | number | boolean, by: number): number {
  return Number(x) * by;
}
console.log(scaled("2.5", 2), scaled(3, 3), scaled(false, 9), scaled(true, 9), scaled("z", 1));
async function later(x: string | number): Promise<number> {
  await null;
  return Number(x) * 2;
}
async function main(): Promise<void> {
  console.log(await later("21"), await later(4), await later("nope"));
}
main().then(() => console.log("done"));
