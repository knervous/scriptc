// A `number | undefined` local read from an optional field across several record shapes (`opts[i]!.v`, the element
// held, then a ternary on its shape) stays an unboxed number: absent, explicit undefined, NaN, -0 and plain values.
interface Opt { v?: number; w?: string }
const opts: Opt[] = [{ v: 1 }, {}, { v: undefined }, { v: NaN }, { v: -0 }, { v: 2.5, w: "x" }, { w: "y" }];
let s = 0, undef = 0, nan = 0, negz = 0;
const seen: string[] = [];
for (let i = 0; i < opts.length; i++) {
  const v = opts[i]!.v;
  if (v === undefined) undef++;
  else if (Number.isNaN(v)) nan++;
  else if (Object.is(v, -0)) negz++;
  s += v ?? 1;
  seen.push(String(v) + ":" + typeof v);
}
console.log(s, undef, nan, negz);
console.log(seen.join(" "));
let t = 0;
for (let i = 0; i < opts.length; i++) { let v = opts[i]!.v; if (i === 3) v = 7; t += v === undefined ? 100 : Number.isNaN(v) ? 1000 : v; }
console.log(t);
opts[1]!.v = 4;
delete opts[0]!.v;
let u = 0;
for (let i = 0; i < 3; i++) { const v = opts[i]!.v; u += v ?? -1; }
console.log(u);
export {};
