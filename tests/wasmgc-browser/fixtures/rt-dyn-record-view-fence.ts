// @native-any-only: the production object model (native any)
// @native-refuses: an object created dynamic and viewed as a typed record would be a copy while the original is still used: the owner's alias rule (agent RT, 10-28) fences it at run time
// @expect-native: registry true
// @expect-native: view true true
// @expect-native-fence: would copy it while
// The native-any form of dyn-record-view-identity: the view of `plain` (created dynamic) would be a copy and `plain`
// is read again, so the conversion throws instead of letting identity and writes diverge. The branded `Wrapper` is a
// record (its brand key is type-only), so `input` holds that record and its view keeps identity.
declare const bufferBrand: unique symbol;
interface Wrapper { readonly [bufferBrand]?: true; readonly byteLength: number; destroyed: boolean }
interface Resource { readonly byteLength: number; destroyed: boolean }
const registry = new Set<Wrapper>();
const created: Wrapper = { byteLength: 16, destroyed: false };
registry.add(created);
const input: any = created;
const view: Resource = input;
created.destroyed = true;
console.log("registry", registry.has(view as Wrapper));
console.log("view", view === input, view.destroyed);
const plain: any = { byteLength: 4, destroyed: false };
const typed: Resource = plain;
typed.destroyed = true;
console.log("any", typed === plain, plain.destroyed);
