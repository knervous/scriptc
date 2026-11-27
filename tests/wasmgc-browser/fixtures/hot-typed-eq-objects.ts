// @native-any-only: constant-key reads through TS any are native dyn reads only in this lane
// `r.id === k` where a record type declares `id` as a number, so the site
// probes for an unboxed number first, over receivers that are not that
// record: records whose `id` field is untyped (a held number compares
// unboxed, anything else takes the generic ===), and native objects read
// through the site's own inline cache (numbers, non-numbers, layouts that
// move the slot, a delete, an accessor, an inherited key, a missing key, a
// page object), always in source evaluation order.
// @hits(native-any): ^\$typed\.f64\.id$
// @hits(native-any): ^\$hit\.typed\.eq\.object$
import { objects } from "./hot-typed-eq-objects-helper.js";
const typed: any[] = [{ id: 1, v: 0 }];
const loose = (r: any) => ({ id: r.id, w: "x" });
const src: any[] = [{ id: 1 }, { id: NaN }, { id: -0 }, { id: "1" }, { id: 2.5 }, { id: true }, { id: null }, { id: undefined }];
const rows: any[] = [...typed, ...src.map(loose), ...objects()];
const keys: any[] = [1, "1", NaN, 0, -0, 2.5, undefined, null, true];
const flags = (xs: any[], f: (r: any) => boolean) => xs.map((r) => (f(r) ? "T" : "F")).join("");
for (const k of keys) console.log(String(k), flags(rows, (r) => r.id === k), flags(rows, (r) => k !== r.id));
// One site, one object whose layout and value change between its reads.
const o: any = objects()[0], seen: string[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(String(o.id === 1));
  if (i === 1) { delete o.id; o.id = 1; }
  if (i === 2) o.id = "1";
  if (i === 3) { o.id = 1; o.extra = 2; }
  if (i === 4) Object.defineProperty(o, "id", { get() { return 1; } });
}
console.log(seen.join(","));
// The other side runs after the read, and may reshape the receiver.
const p: any = { id: 1 };
let n = 0;
const reshape = (): any => { n++; p.id = 2; return 1; };
console.log(p.id === reshape(), n, p.id === 2);
