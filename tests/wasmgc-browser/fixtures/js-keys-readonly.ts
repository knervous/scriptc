// @hits(native,native-any): keys\.ro
// Object.keys whose result is only read (a shallowEqual) may share one array per
// shape or record type; any other use (push, sort, return, store, capture,
// reassignment) keeps a fresh array, and shape changes are always seen.
import { shallowEqual, listKeys, count, escaped, forIn, forInMutate, shapes } from "./js-keys-readonly-helper.js";
console.log(shapes());
interface P { id: number; label: string; on: boolean }
const p1: P = { id: 1, label: "a", on: true }, p2: P = { id: 1, label: "a", on: true }, p3: P = { id: 2, label: "a", on: true };
console.log(shallowEqual(p1, p2), shallowEqual(p1, p3), shallowEqual(p1, { id: 1, label: "a", on: true, more: 1 }), listKeys(p1), count(p1));
console.log(escaped(p1).join(","), listKeys(p1), escaped(p2).length, count(p2));
console.log(forIn(p1), forIn(p3), forIn({ a: 1, b: 2 }), forInMutate(JSON.parse('{"a":1,"b":2,"c":3}')));
const rows: P[] = [];
for (let i = 0; i < 5; i++) rows.push({ id: i, label: "r" + i, on: i % 2 === 0 });
let eq = 0; for (let i = 1; i < rows.length; i++) if (shallowEqual(rows[i - 1], rows[i])) eq++;
console.log(eq, rows.map(r => forIn(r)).join(" "));
