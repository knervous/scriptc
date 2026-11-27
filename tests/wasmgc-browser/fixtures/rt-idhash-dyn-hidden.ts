// @native-any-only: dyn objects, arrays and closures held by `any`; the plain native lane keeps them as page values
// A dyn object, array or closure that served as a Map / Set key carries its id as a hidden, internal property: no key list, JSON,
// spread, descriptor, for-in, Object.assign or structured clone shows it, and later writes, pushes and deletes behave as on an
// object that was never a key.
// @hits(native-any): ^\$dyn\.idHash$
const g = globalThis as any;
const plain: any = { x: 1, y: 2 };
const list: any[] = [1, 2, 3];
const fn: any = () => 1;
const keyed = new Map<unknown, string>().set(plain, "plain").set(list, "list").set(fn, "fn");
const keyedSet = new Set<unknown>([plain, list, fn]);
console.log(keyed.size, keyedSet.size, keyed.get(plain), keyed.get(list), keyed.get(fn), keyedSet.has(plain), keyedSet.has(list), keyedSet.has(fn), keyed.get([1, 2, 3]));
console.log(Object.keys(plain).join(), JSON.stringify(plain), JSON.stringify({ ...plain }), Object.getOwnPropertyNames(plain).join(), Reflect.ownKeys(plain).length);
console.log(Object.entries(plain).join(";"), JSON.stringify(structuredClone(plain)), Object.keys(list).join(), JSON.stringify(list), list.length, Object.getOwnPropertyNames(list).join());
const forIn: string[] = []; for (const k in plain) forIn.push(k);
console.log(forIn.join(), Object.keys(Object.getOwnPropertyDescriptors(plain)).join(), Object.keys(Object.assign({}, plain)).join(), Object.getOwnPropertyNames(fn).join());
console.log(g.Object.keys(plain).join(), g.JSON.stringify(plain), g.JSON.stringify(list), g.Object.getOwnPropertyNames(list).join());
// mutation after hashing
plain.z = 3; list.push(4); delete plain.x;
console.log(JSON.stringify(plain), JSON.stringify(list), keyed.get(plain), keyed.get(list), Object.isFrozen(plain), Object.isExtensible(plain), Object.keys(plain).join());
// frozen after hashing: still found
Object.freeze(plain); Object.freeze(list);
console.log(keyed.get(plain), keyed.get(list), Object.isFrozen(plain), Object.keys(plain).join(), JSON.stringify(list));
// hashed only after freezing (an object that cannot gain a property)
const cold: any = Object.freeze({ a: 1 }), coldList: any = Object.freeze([1]);
const late = new Map<unknown, string>().set(cold, "cold").set(coldList, "coldList");
console.log(late.get(cold), late.get(coldList), late.has({ a: 1 }), JSON.stringify(cold), JSON.stringify(coldList), Object.keys(cold).join());
