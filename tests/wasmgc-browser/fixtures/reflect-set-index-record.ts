// @known-defect(engine,native,native-any): Reflect.set on a typed index-signature record goes through the page (js.reflectSet on the record's page view), adopting it; the static Object.keys of the record then misses the page object's keys (reads still answer); under native-sim the host refuses the opaque record (WebAssembly objects are opaque)
// Reflect.set of run-time keys on an index-signature record, then the record's own keys. Same output as Node.
type Bag = { [key: string]: number };
const bag: Bag = {};
Reflect.set(bag, "a", 1);
Reflect.set(bag, "b", 2);
console.log(`[${Object.keys(bag).join(",")}]`, bag["a"], bag["b"]);
export {};
