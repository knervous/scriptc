// Typed arrays inside compiled JS keep their identity: reads, index writes
// and push alias the original; non-mutating methods; keys; isArray.
import { arrOps } from './r4-typed-helper.js';
const xs: number[] = [1, 2, 3];
const r: string = arrOps(xs);
console.log(r, xs.length, xs.join(","));
