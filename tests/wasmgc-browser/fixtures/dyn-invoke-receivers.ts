// Generic method calls on dyn receivers: the site handles arrays, a shared
// per-method helper the rest (objects, functions, typed records, strings,
// numbers, booleans, nullish, page values), with Node's exact errors.
// Missing methods on strings, numbers and page values are left out: the
// host's js.callMethod reports "o[k] is not a function" in every lane.
// @native-only: engine dyn calls every method through the host, so its missing-method messages are the host's (o[k] is not a function)
// @hits(native,native-any): ^\$dyn\.invoke\.describe\.1$
// @hits(native,native-any): ^\$dyn\.invoke\.describe\.1\.cold$
import { call0, call1, call5, caught, each, fixed, objects, show, slice1, toS, viaApply, viaBind, viaCall } from "./dyn-invoke-receivers-helper.js";
const objs = objects(), own = objs[0], child = objs[1], plain = objs[2];
console.log(call0(own), call1(own, "a"), call5(own), call1(child, 7), call5(child));
console.log(caught(() => call1(plain, 1)), caught(() => call0(undefined)), caught(() => call1(null, 1)));
const record = { name: "rec", describe: (a?: unknown) => "record " + String(a) };
console.log(call1(record, 3), call0(record));
console.log(slice1([1, 2, 3], 1).join(","), slice1("hello", 2), toS([1, [2, 3]]), toS(42), toS(true), toS("s"), fixed(3.14159));
console.log(caught(() => call1([1, 2], 1)), caught(() => call0([])), caught(() => call1({ describe: 5 }, 1)));
const self = { tag: "T" };
console.log(viaCall(show, self, 1), viaApply(show, self, 2), viaBind(show, self, 3), viaCall(show, undefined, 4));
console.log(each([5, 6]), each("ab".split("")), caught(() => each({})));
// A page value (the gate prelude's Float32Array): the host runs its methods.
const floats = (globalThis as any).auditFloats();
console.log(toS(floats), slice1(floats, 1).length);
