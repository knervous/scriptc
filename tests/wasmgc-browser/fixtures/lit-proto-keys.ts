// Literal members named like Object.prototype properties: "constructor", "__proto__",
// "toString", "hasOwnProperty", "valueOf". Comparisons, switch, Map/Set keys, records built with
// computed keys, `in`, JSON, and spread must treat them as the plain strings they are.
type Key = "constructor" | "__proto__" | "toString" | "hasOwnProperty" | "valueOf" | "plain";
const KEYS: Key[] = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "plain"];

function idx(k: Key): number {
  switch (k) {
    case "constructor": return 0;
    case "__proto__": return 1;
    case "toString": return 2;
    case "hasOwnProperty": return 3;
    case "valueOf": return 4;
    default: return 5;
  }
}
console.log(KEYS.map(idx).join(","), KEYS.map((k) => k.length).join(","), KEYS.join("|"));
console.log(KEYS.map((k) => (k === "__proto__" ? "P" : k === "constructor" ? "C" : k === "toString" ? "T" : "-")).join(""));

// As Map/Set keys.
const m = new Map<Key, number>();
for (const k of KEYS) m.set(k, idx(k) * 10);
console.log(m.size, m.get("__proto__"), m.get("constructor"), m.get(("to" + "String") as Key), [...m.keys()].join(","));
const s = new Set<Key>(KEYS);
console.log(s.has("valueOf"), s.has("__proto__"), s.size);

// Records with own properties named by these literals (defineProperty-free: computed keys on a
// null-prototype object, so `__proto__` is an own data property).
const bag: Record<string, number> = Object.create(null);
for (const k of KEYS) bag[k] = idx(k);
console.log(JSON.stringify(bag), bag["__proto__"] !== undefined, bag["constructor"], bag[KEYS[2]]);

// `in` against an ordinary object: inherited names are found, own data keys too.
const ord: { plain: number } = { plain: 1 };
console.log(KEYS.map((k) => (k in ord ? 1 : 0)).join(""), KEYS.map((k) => (Object.prototype.hasOwnProperty.call(ord, k) ? 1 : 0)).join(""));

// A record whose values are these literals, stringified and spread.
const rec: { a: Key; b: Key; c: Key } = { a: "__proto__", b: "constructor", c: "toString" };
const copy = { ...rec };
console.log(JSON.stringify(rec), JSON.stringify(copy), copy.a === "__proto__", Object.values(copy).map(idx).join(","));
console.log(JSON.stringify(JSON.parse('{"k":"constructor"}').k === "constructor"));

// Held in a class field and compared.
class Holder { k: Key = "toString"; }
const h = new Holder();
h.k = KEYS[1];
console.log(h.k, h.k === "__proto__", JSON.stringify(h), Object.keys(h).join(","));
