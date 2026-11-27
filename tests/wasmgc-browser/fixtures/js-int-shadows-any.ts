// Int shadows under native TS `any`: an `any` local holding an int read in number contexts
// (a checked conversion) and as an int word; other numbers convert exactly.
// @native-any-only: TS `any` locals are native dyn only in the native-any lane
// @hits(native-any): ^\$hit\.shadow\.def$
const words = (a: any, b: any): string => {
  let x: any = a & b;
  const n: number = x;
  const hi = (x & 4) !== 0;
  x = a;
  const m: number = x;
  return `${n * 10 + m} ${hi} ${x === a}`;
};
console.log(words(6, 3), words(7, 7), words(-1, 2147483647));
const numbers = (v: any): string => { let x: any = v & 1; const a: number = x; x = v; const b: number = x; return `${a} ${b} ${Object.is(b, -0)}`; };
console.log(numbers(5), numbers(2.5), numbers(-0), numbers(2 ** 31), numbers(NaN));
