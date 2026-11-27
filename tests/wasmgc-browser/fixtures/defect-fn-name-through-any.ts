// Regression (formerly a known defect): a compiled function's name and length read through TS any (engine and native read its page wrapper; native-any its own properties).
const fn: any = function named(a: number, b: number) { return a + b; };
console.log(fn.name, fn.length);
