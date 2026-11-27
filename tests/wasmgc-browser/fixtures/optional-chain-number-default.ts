// `rec?.n ?? d` and `const v = rec?.n` (a number | undefined from an optional chain) as unboxed numbers: a missing
// receiver, a missing or undefined field of a page-backed record, NaN and -0 values, nested chains, and a pop's `!`.
interface Doc { id: number; score?: number; parent?: Doc }
const docs: Doc[] = [];
for (let i = 0; i < 6; i++) docs.push({ id: i, ...(i % 2 ? { score: i * 1.5 } : {}), ...(i > 0 ? { parent: docs[i - 1] } : {}) });
docs[3]!.score = NaN;
docs[4]!.id = -0;
let s = 0;
const parts: string[] = [];
for (let i = 0; i < docs.length; i++) {
  s += docs[i]!.parent?.id ?? -1;
  const sc = docs[i]!.parent?.score;
  parts.push(String(sc) + (Object.is(docs[i]!.parent?.id, -0) ? "z" : ""));
  s += docs[i]!.parent?.parent?.score ?? 100;
}
console.log(s, parts.join(","));
const parsed = JSON.parse('[{"id":1},{"id":2,"parent":{"id":7}},{"id":3,"parent":{"id":4,"score":2}}]') as Doc[];
let t = 0;
const seen: string[] = [];
for (let i = 0; i < parsed.length; i++) {
  t += parsed[i]!.parent?.id ?? 50;
  const v = parsed[i]!.parent?.score;
  seen.push(typeof v);
  t += parsed[i]!.parent?.score ?? 0.5;
}
console.log(t, seen.join(","));
const maybe: (Doc | undefined)[] = [docs[1], undefined, docs[2]];
let u = 0;
for (let i = 0; i < maybe.length; i++) u += maybe[i]?.score ?? 0.25;
console.log(u);
const stack = [1.5, -0, NaN];
let w = 0;
const order: string[] = [];
while (stack.length) { const x = stack.pop()!; order.push(Object.is(x, -0) ? "-0" : String(x)); w += x; }
console.log(order.join(","), w);
let q = 0;
for (let i = 0; i < docs.length; i++) { const p = docs[i]!.parent?.parent?.id; q += p === undefined ? 1000 : p; }
console.log(q);
export {};
