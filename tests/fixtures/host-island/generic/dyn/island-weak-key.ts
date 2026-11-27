// WeakMap / WeakSet keyed on island objects held as untyped data: the key is the object's identity (the same object
// read again finds its entry; an equal-looking one does not). The host reports an object's death, so the entry never
// outlives its key.
const g: any = globalThis;
g.box = { id: 1 };
const key: unknown = g.box;
const map = new WeakMap<object, string>();
const set = new WeakSet<object>();
map.set(key as object, "boxed");
set.add(key as object);
console.log(map.get(g.box), map.has(g.box), map.has({ id: 1 }), set.has(g.box));
console.log(map.delete(g.box), map.has(g.box), set.delete(g.box), set.has(g.box));
