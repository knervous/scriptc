// A nullish source of an object pattern throws V8's "Cannot destructure
// property 'x' of 'v' as it is null." (JS declarations and assignments, TS any).
import { run } from "./dyn-destructure-messages-helper.js";
console.log(run(null));
console.log(run(undefined));
console.log(run({ x: 1, y: 2, z: 3, "s-k": 4 }));
function first(t0: any) { const { id } = t0; return id; }
for (const v of [null, undefined]) { try { first(v); } catch (e) { console.log((e as Error).message); } }
