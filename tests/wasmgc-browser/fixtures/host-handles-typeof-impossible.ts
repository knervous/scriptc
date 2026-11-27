// @options: {"hostHandles": true}
// typeof can never be "unknown" (or any non-ES name): the test folds, the operand still runs
// (React's old-IE probe `"unknown" !== typeof event.cancelBubble`). A compiled Map/Set crossing
// to the page and back keeps its identity and entries.
import { probe, kinds } from "./host-handles-typeof-impossible-helper.js";
let reads = 0;
const ev = { get cancelBubble() { reads++; return false; } };
console.log(probe(ev).join(","), reads);
console.log(kinds(5).join(","));
const g = globalThis as any;
const m = new Map<string, number>([["a", 1]]);
const s = new Set<number>([1, 2]);
g.__m = m; g.__s = s;
const m2 = g.__m as Map<string, number>, s2 = g.__s as Set<number>;
console.log(m2 === m, m2.get("a"), s2.has(2), s2.size);
