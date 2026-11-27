// JS `%` computes the exact remainder in Wasm ($math.fmod; no host math.fmod): untyped (dyn)
// operands through the JS helper and typed number operands, over ±0, ±Infinity, NaN,
// subnormals, 2^53 boundaries, huge quotients and pseudo-random doubles of every exponent.
// @hits(native,native-any): ^\$math\.fmod$
import { EDGES, table, dynMod, sweep, counters } from "./dyn-number-mod-helper.js";
const typedMod = (a: number, b: number): number => a % b;
console.log(table(dynMod));
console.log(table(typedMod) === table(dynMod));
console.log(sweep(dynMod, 4000));
console.log(sweep(typedMod, 4000));
console.log(counters());
let t = 0;
for (const x of EDGES) t += Number.isNaN(x % 3) ? 1 : 0;
console.log(t);
