// Map values that are closures on the browser target (a reader/handler registry: Map<string, () => Counts>): set,
// replace, iterate and call, get-and-call, delete, a constructor of pairs. The index-signature registry already held
// closures; the Map form refused SC2009 (the client's resource-count registry).
type Reader = () => Record<string, number>;
const readers = new Map<string, Reader>();
let n = 0;
readers.set("a", () => ({ x: 1, n: ++n }));
readers.set("b", () => ({ y: 2 }));
readers.set("a", () => ({ x: 10, n: ++n }));
const out: Record<string, Record<string, number>> = {};
for (const [k, read] of readers) out[k] = read();
console.log(JSON.stringify(out), readers.size, readers.get("b")!().y, readers.has("c"));
readers.delete("b");
const handlers = new Map<number, (v: string) => string>([[1, (v) => v + "!"]]);
console.log([...readers.keys()].join(","), handlers.get(1)?.("hi"), [...handlers.values()].map((f) => f("x")).join());
