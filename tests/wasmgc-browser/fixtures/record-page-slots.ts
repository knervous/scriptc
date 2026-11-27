// @known-defect(engine): a Map inside a record crossing to the page arrives without its Map surface (size reads undefined), with or without page slots
// Browser target: a record with a page-typed field (a DOM/GPU handle) stays a
// native record with an opaque slot, so its compiled members (Maps, typed
// arrays, numbers) stay compiled; the handle round-trips by reference and the
// record still crosses to the page whole.
import { labelOf, makeHandle } from "./record-page-slots-helper.js";
interface Material {
  name: string;
  handle: EventTarget | null;
  extra?: EventTarget;
  values: Map<string, Float32Array>;
  version: number;
}
function make(name: string): Material {
  return { name, handle: null, values: new Map([["tint", new Float32Array([1, 0.5, 0.25])]]), version: 0 };
}
const m = make("stone");
m.values.get("tint")![1] = 0.75;
m.version++;
console.log(m.name, m.values.get("tint")![1], m.version, m.handle === null, m.extra === undefined);
const h = makeHandle("ubo") as EventTarget;
m.handle = h;
m.extra = h;
console.log(m.handle === h, m.extra === m.handle, labelOf(m));
let fired = 0;
m.handle.addEventListener("ping", () => { fired++; });
m.handle.dispatchEvent(new Event("ping"));
console.log(fired, [...m.values.keys()].join());
