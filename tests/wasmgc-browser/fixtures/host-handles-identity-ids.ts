// @options: {"hostHandles": true}
// @hits(native,native-any): ^\$dyn\.idHash$
// Class instances and typed records as Map/Set/WeakMap keys hash through their own lazily assigned id slot (compiled-side, O(1));
// the slot is invisible to keys, JSON, structuredClone, spreads and descriptors.
class Node { label: string; next: Node | null; constructor(label: string, next: Node | null = null) { this.label = label; this.next = next; } }
class Leaf extends Node { weight = 3; }
interface Rec { a: number; b: string }
const nodes: Node[] = [];
for (let i = 0; i < 300; i++) nodes.push(i % 3 === 0 ? new Leaf("n" + i) : new Node("n" + i));
const byNode = new Map<Node, number>();
const seen = new Set<Node>();
const weak = new WeakMap<Node, string>();
nodes.forEach((n, i) => { byNode.set(n, i); seen.add(n); weak.set(n, n.label); });
let ok = byNode.size === 300 && seen.size === 300;
nodes.forEach((n, i) => { if (byNode.get(n) !== i || !seen.has(n) || weak.get(n) !== n.label) ok = false; });
const stranger = new Node("n0");
console.log(ok, byNode.has(stranger), seen.has(stranger), weak.has(stranger), byNode.delete(nodes[5]), byNode.size, byNode.has(nodes[5]));
const recs: Rec[] = [];
for (let i = 0; i < 100; i++) recs.push({ a: i, b: "r" + i });
const byRec = new Map<Rec, number>();
recs.forEach((r, i) => byRec.set(r, i));
let rok = true; recs.forEach((r, i) => { if (byRec.get(r) !== i) rok = false; });
console.log(rok, byRec.has({ a: 0, b: "r0" }), byRec.size);
// the id slot is not a property
const leaf = nodes[0] as Leaf;
console.log(Object.keys(leaf).join(), JSON.stringify(leaf), JSON.stringify(recs[1]), Object.keys(recs[1]).join());
console.log(JSON.stringify({ ...leaf }), JSON.stringify(structuredClone(recs[2])), Object.keys(leaf).length);
// mixed key kinds in one Map
const mixed = new Map<unknown, string>();
const g = globalThis as any;
const page = new g.Object();
mixed.set(leaf, "leaf").set(recs[0], "rec").set(page, "page").set("s", "str").set(1, "num").set(nodes[1], "node");
console.log(mixed.get(leaf), mixed.get(recs[0]), mixed.get(page), mixed.get("s"), mixed.get(1), mixed.get(nodes[1]), mixed.get(new Node("x")));
// collections as keys
const colls: unknown[] = [];
for (let i = 0; i < 50; i++) colls.push(i % 2 ? new Map<number, number>([[i, i]]) : new Set<number>([i]));
const byColl = new Map<unknown, number>();
colls.forEach((c, i) => byColl.set(c, i));
let cok = true; colls.forEach((c, i) => { if (byColl.get(c) !== i) cok = false; });
console.log(cok, byColl.size, byColl.has(new Map()), byColl.has(new Set()));
