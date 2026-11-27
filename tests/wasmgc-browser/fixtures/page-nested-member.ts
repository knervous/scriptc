// Reading nested members off a value the page holds: a record member, an
// array member, a primitive at the end of the chain, and a write back.
import { makeStream as rawMake } from "./page-nested-member-helper.js";
interface Stats { _values: number[]; phase: string; nested: { depth: number } }
interface Stream { stats: Stats; _manifest: { leaves: string[] } }
const h: any = globalThis;
const makeStream = rawMake as () => Stream;
const stream = h.__keepPage ? makeStream() : makeStream();
console.log(stream.stats.phase, stream.stats.nested.depth, stream._manifest.leaves.length);
const values = stream.stats._values;
let sum = 0;
for (const v of values) sum += v;
console.log(sum, values.length);
