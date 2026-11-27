// A Map / Set / WeakSet whose key type is not one class (unknown, or a union of classes, records and strings) mixes compiled
// instances, typed records, dyn objects, closures and page objects in one table. Compiled references hash inside Wasm,
// page objects through the host; every kind is found by identity, and none of them shows an id in keys, JSON, spreads, descriptors
// or a structured clone (the compiled-side reads are in rt-idhash-dyn-hidden).
// @hits(native,native-any): ^\$hash\.
class Sprite { readonly n: number; constructor(n: number) { this.n = n; } }
interface Tag { t: string }
const g = globalThis as any;
const sprite = new Sprite(1), sprite2 = new Sprite(1);
const tag: Tag = { t: "a" }, tag2: Tag = { t: "a" };
const plain: any = { x: 1, y: 2 }, plain2: any = { x: 1, y: 2 };
const fn = () => 1, fn2 = () => 1;
const page = new g.Object(), page2 = new g.Object();
const pageArr = new g.Array(), pageFn = new g.Function("return 1");
const bag = new Map<unknown, string>();
bag.set(sprite, "sprite").set(tag, "tag").set(plain, "plain").set(fn, "fn").set(page, "page").set(pageArr, "pageArr").set(pageFn, "pageFn");
bag.set("s", "str").set(1, "num").set(null, "null").set(undefined, "undef").set(NaN, "nan").set(true, "bool");
const probe = [sprite, sprite2, tag, tag2, plain, plain2, fn, fn2, page, page2, pageArr, pageFn, "s", 1, null, undefined, NaN, true, false, 2];
console.log(bag.size, probe.map((k) => String(bag.get(k))).join());
console.log(probe.map((k) => bag.has(k) ? 1 : 0).join(""));
// deletion and re-insertion move an entry to the end, whatever its kind
for (const k of [sprite, tag, plain, fn, page, "s", 1]) bag.delete(k);
console.log(bag.size, [...bag.values()].join());
for (const k of [page, sprite, plain, fn, tag, "s", 1]) bag.set(k, "again");
console.log(bag.size, [...bag.values()].join());
console.log([...bag.keys()].map((k) => k === sprite ? "sprite" : k === tag ? "tag" : k === plain ? "plain" : k === fn ? "fn" : k === page ? "page" : String(k)).join());
// collections as keys: a compiled Map and Set carry their own id, a page Map is hashed by the host
const mapKey = new Map<number, number>([[1, 1]]), mapKey2 = new Map<number, number>([[1, 1]]), setKey = new Set<number>([1]), setKey2 = new Set<number>([1]);
const pageMapKey = new g.Map(), typedKey = new Uint8Array(2), typedKey2 = new Uint8Array(2);
const colls = new Map<unknown, string>().set(mapKey, "map").set(setKey, "set").set(pageMapKey, "pageMap").set(typedKey, "typed");
console.log(colls.get(mapKey), colls.get(mapKey2), colls.get(setKey), colls.get(setKey2), colls.get(pageMapKey), colls.get(typedKey), colls.get(typedKey2), colls.size);
colls.delete(mapKey); colls.set(mapKey, "map again");
console.log([...colls.values()].join());
// a Set of the same, and a WeakSet of the objects
const marks = new Set<unknown>([sprite, tag, plain, fn, page, sprite, tag, plain, fn, page]);
const weak = new WeakSet<object>([sprite, tag, plain, fn, page]);
console.log(marks.size, marks.has(sprite), marks.has(sprite2), weak.has(tag), weak.has(tag2), weak.has(plain), weak.has(plain2), weak.has(page), weak.has(page2));
// a union key type
const named = new Map<Sprite | Tag | string, number>([[sprite, 1], [tag, 2], ["k", 3]]);
console.log(named.get(sprite), named.get(tag), named.get("k"), named.get(sprite2), named.get(tag2), named.delete(tag), named.size, [...named.values()].join());
// the id of a dyn object, array or closure that served as a key is not a property (read through the page)
console.log(g.Object.keys(plain).join(), g.JSON.stringify(plain), g.Reflect.ownKeys(plain).length);
// the compiled objects still behave: fields, methods, mutation after hashing
plain.z = 3;
console.log(g.JSON.stringify(plain), bag.get(plain), g.Object.isFrozen(plain), g.Object.isExtensible(plain));
