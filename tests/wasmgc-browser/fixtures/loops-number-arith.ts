// A number accumulator over dyn values (`s += row.v` with `s: number`):
// two numbers take the f64 operation; any other operand keeps the dyn
// operator and its number check, in source evaluation order.
// @hits(native-any): ^\$hit\.arith\.f64$
const vals: any[] = [1, 2.5, -0, 0, NaN, 2 ** 31, -(2 ** 30), 1e300, Infinity, -Infinity, 0.1];
let sum = 0, diff = 0, prod = 1, quot = 1;
for (let i = 0; i < vals.length; i++) {
  sum += vals[i]; diff -= vals[i]; prod *= vals[i] === 0 ? 1 : vals[i]; quot /= vals[i] === 0 ? 1 : vals[i];
}
console.log(sum, diff, prod, quot);
// -0 survives: -0 + -0 is -0, 0 - 0 is 0.
let z = -0; z += (-0 as any); console.log(Object.is(z, -0));
let z2 = 0; z2 -= (0 as any); console.log(Object.is(z2, 0));
// Number on the right of a dyn left operand.
const rows: any[] = [{ v: 3 }, { v: 4.5 }, { v: -1 }];
let total = 0;
for (const r of rows) total = r.v + total;
console.log(total);
// Order: the left read happens before the right side's effects.
let n = 0, order = "";
const left = (): any => { order += "L"; return 1; }, right = (): any => { order += "R"; return 2; };
n = left() + right(); console.log(n, order);
// Non-number operands take the generic operator: booleans, null, objects with valueOf.
let acc = 0;
const odd: any[] = [true, null, { valueOf() { return 5; } }, false];
for (const o of odd) acc += o;
console.log(acc);
let m = 10; m -= ("3" as any); m *= ("2" as any); console.log(m);
