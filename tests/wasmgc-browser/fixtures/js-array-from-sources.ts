// Array.from in untyped code over a non-literal source walks its iterator
// (or its length, for an array-like), in every lane.
import { run } from "./js-array-from-sources-helper.js";
const h: any = globalThis;
console.log(run(new h.Set([1, 2]), "ab", JSON.parse('{"length":2,"0":"x","1":"y"}'), new h.Map([[1, 2]]).keys()));
