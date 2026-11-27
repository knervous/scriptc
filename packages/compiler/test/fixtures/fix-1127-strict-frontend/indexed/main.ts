// An index read the checker types as present: under noUncheckedIndexedAccess it is `number | undefined`.
const xs: number[] = [1, 2, 3];
const n: number = xs[5];
console.log(n);
