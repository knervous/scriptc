// Constant-key dyn reads (per-key typed readers, hot/cold split): typed
// records with the key at different positions or absent, index-signature
// overflow, records the page reshaped (facade-adopted), typed arrays, class
// instances with getters and expandos, errors, page values and getters,
// nullish receivers and V8's TypeError text, canonical index keys (constant
// and computed: "01", "-0", "1e3", " 1" are not indices).
// @native-only: the engine lane misreads index-signature overflow and class getters, and traps on class expandos (pre-existing)
import { readAll, readId, readIdOpt, readLen, readChain, addExpando, arrayKeys } from "./audit-constant-keys-helper.js";
const h: any = globalThis;
const show = (label: string, v: any) => console.log(label + ": " + readAll(v));
show("a", { id: 1, n: 2 }); show("b", { n: 3, id: "two", extra: true }); show("c", { n: 4 }); show("d", { length: 9, id: 5 }); show("e", { x: 1 });
const idx: Record<string, number> = { n: 1 };
idx["id"] = 77; idx["extra"] = 5;
show("idx", idx);
const adopted = { id: 10, n: 11 };
h.auditDeleteKey(adopted, "id");
show("adoptedDelete", adopted);
const getterRec = { id: 20, n: 21 };
h.auditAccessorPage().defineGetter(getterRec, "id", 42);
show("adoptedGetter", getterRec);
show("nums", [5, 6, 7]); show("strs", ["p", "q"]); show("tuple", [1, "a"] as [number, string]);
class Box { id = 3; n = 4; get g() { return "g" + this.id; } }
class Sub extends Box { extra = "e"; override get g() { return "s" + super.g; } }
const box = new Box(), sub = new Sub();
show("box", box); show("sub", sub);
addExpando(box); addExpando(sub);
show("boxExpando", box); show("subExpando", sub);
let caught: unknown; try { readId(null); } catch (x) { caught = x; }
show("caught", caught);
show("made", new RangeError("bad"));
show("page", h.auditMake()); show("pageArr", h.auditMakeArray());
const acc = h.auditMakeAccessor();
show("pageGetter", acc); console.log("hits", h.auditAccessorHits());
for (const v of [null, undefined]) {
  try { readId(v); } catch (x) { console.log("readId", (x as Error).name, (x as Error).message); }
  try { readLen(v); } catch (x) { console.log("readLen", (x as Error).name, (x as Error).message); }
  console.log("opt", readIdOpt(v));
}
console.log(readChain({ inner: { id: 3 } }), readChain({ inner: null }), readChain(null), readChain({}));
console.log(arrayKeys());
// The same reads through TS any.
const ra: any = { a: 1 }, rb: any = { b: 2 }, rab: any = { a: 3, b: 4 }, rba: any = { b: 5, a: 6 };
console.log([ra, rb, rab, rba].map((r: any) => String(r.a) + "/" + String(r.b)).join(" "));
const len: any = { length: 7, id: "s" };
console.log(len.length, len.id);
const u: any = undefined;
try { console.log(u.id); } catch (x) { console.log((x as Error).name, (x as Error).message); }
console.log(u?.id, u?.a.b);
const arr: any = [10, 20, 30];
const k: any = "01", k2: any = 2;
console.log(arr[k], arr["-0"], arr[k + ""], arr[k2], arr["01"], arr.length);
