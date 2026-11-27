// Number-to-string conversions around the small-integer table: -0, 0, the
// last cached value and the first uncached one, fractions, negatives, NaN,
// repeats (served from the table), and the same values through untyped JS.
// @hits: ^\$undef\.num\.toString$
import { spell } from "./num-to-string-small-helper.js";
const xs: number[] = [0, -0, 1, 7, 1023, 1024, 1e6, 2.5, -1, -0.5, NaN, Infinity, 1e21, 5e-7, 0.1 + 0.2];
const out: string[] = [];
for (let r = 0; r < 2; r++) for (const x of xs) out.push(String(x), "" + x, `${x}`);
console.log(out.join(" "));
console.log(spell(xs));
const keyed: Record<string, number> = {};
for (let i = 0; i < 4; i++) keyed[String(i * 511)] = i;
console.log(Object.keys(keyed).join(","));
