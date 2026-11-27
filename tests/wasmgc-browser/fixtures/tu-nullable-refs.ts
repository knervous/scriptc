// Unions of one reference type with null and/or undefined (`T | null`,
// `T | undefined`, `T | null | undefined`) are held as the reference itself:
// null and undefined stay distinct through ===, ==, typeof, truthiness,
// optional chaining, ??, narrowing, conversions between the three forms,
// array and Map element reads, and identity search.
class Node {
  next: Node | null = null;
  parent?: Node;
  link: Node | null | undefined;
  id: number;
  constructor(id: number) { this.id = id; this.link = id % 3 === 0 ? null : id % 3 === 1 ? undefined : this; }
}
type Rec = { name: string; tags: string[] | null };
function desc<T extends object>(x: T | null | undefined): string { return x === null ? "null" : x === undefined ? "undef" : typeof x; }

// A linked list through `Node | null`, parents through `Node | undefined`.
let head: Node | null = null;
for (let i = 0; i < 6; i++) { const n = new Node(i); n.next = head; if (head) head.parent = n; head = n; }
let ids = "";
for (let n = head; n !== null; n = n.next) ids += n.id + (n.parent ? "^" + n.parent.id : "") + " ";
console.log(ids);
const tail = (() => { let n = head!; while (n.next) n = n.next; return n; })();
console.log(tail.id, tail.next === null, tail.next === undefined, tail.next == null, tail.parent?.id, head!.parent === undefined, head!.parent == null);

// The three-armed form: null, undefined and a reference stay apart.
const links: (Node | null | undefined)[] = [];
for (let n = head; n !== null; n = n.next) links.push(n.link);
console.log(links.map(desc).join(","), links.map(l => l === null).join(","), links.map(l => l === undefined).join(","), links.map(l => l == null).join(","));
console.log(links.map(l => l?.id ?? -1).join(","), links.map(l => (l ? "t" : "f")).join(""), links.map(l => typeof l).join(","));
let widened: Node | null | undefined = head;
widened = head!.next;
const asNull: Node | null = head!.next!.link === undefined ? null : head!.next!.next;
widened = asNull;
console.log(desc(widened), widened === null ? "is null" : widened?.id);
function count(xs: (Node | null | undefined)[], want: Node | null | undefined): number { let c = 0; for (const x of xs) if (x === want) c++; return c; }
console.log(count(links, null), count(links, undefined), count(links, head!.next!.next!.next));

// Narrowing: !==, truthiness, typeof, instanceof, ??=.
function walk(start: Node | null | undefined): string {
  const out: string[] = [];
  let cur = start;
  while (cur != null) { out.push(String(cur.id)); cur = cur.next; }
  return out.join(">") + (cur === null ? "|null" : "|undef");
}
console.log(walk(head), walk(undefined), walk(null), walk(tail));
let lazy: Node | undefined;
lazy ??= new Node(42);
lazy ??= new Node(43);
const lz: Node = lazy;
console.log(lazy.id, typeof lazy === "object", lz instanceof Node);

// Records, arrays, closures and maps as the reference arm.
const recs: (Rec | undefined)[] = [{ name: "a", tags: ["x", "y"] }, undefined, { name: "b", tags: null }];
console.log(recs.map(r => r?.name ?? "-").join(","), recs.map(r => r?.tags?.length ?? "n").join(","), recs.map(r => r?.tags === null).join(","));
console.log(JSON.stringify(recs[0]!), JSON.stringify(recs[2]!), JSON.stringify({ r: recs[1] ?? null, t: recs[2]!.tags }));
function pickFn(on: boolean): ((x: number) => number) | null { return on ? (x => x + 1) : null; }
const cb: ((x: number) => number) | undefined = recs.length > 2 ? (x => x * 2) : undefined;
const none = pickFn(recs.length > 5);
console.log(cb?.(21), none?.(1), cb === undefined, none === null, typeof cb, typeof none);
const groups = new Map<string, Node | null>();
groups.set("h", head); groups.set("n", null);
const g1 = groups.get("h"), g2 = groups.get("n"), g3 = groups.get("missing");
console.log(desc(g1), desc(g2), desc(g3), g1?.id, g2 === null, g3 === undefined, g2 == g3, g1 === g2);
const lists: (number[] | null)[] = [[1, 2], null, [3]];
const popped = lists[2], shifted = lists[1], rest = lists[0], empty = lists[3];
console.log(desc(popped), desc(shifted), desc(rest), desc(empty), popped?.length, shifted === null, lists.at(-1)?.length, desc(lists.find(l => l === null)));
const pool: (Node | null)[] = [head, null, tail];
console.log(pool.indexOf(tail), pool.indexOf(null), pool.includes(null), pool.indexOf(new Node(9)), pool.lastIndexOf(head));
const sparse: (Node | undefined)[] = [];
sparse[3] = tail;
console.log(sparse.length, desc(sparse[0]), desc(sparse[3]), sparse.findIndex(x => x !== undefined), 1 in sparse);

// Equality between values of one union and String().
const a: Node | null = head, b: Node | null = head, c: Node | null = null, d: Node | null = null;
console.log(a === b, a !== c, c === d, Object.is(c, d), Object.is(a, c), `${recs[0] === undefined}`);
