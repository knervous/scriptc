// @hits(native,native-any): ^\$dyn\.add$
// '' + x / x + '' on dyn values: string operands pass through unchanged, everything
// else keeps ToPrimitive (default hint, valueOf before toString) and the exact errors.
import { show, showR, both, attr, same, sideEffects, values, bads } from "./dyn-empty-string-add-helper.js";
for (const v of values()) {
  let a: string, b: string;
  try { a = show(v); } catch (e) { a = "throws " + (e instanceof TypeError ? "TypeError" : "other"); }
  try { b = showR(v); } catch (e) { b = "throws " + (e instanceof TypeError ? "TypeError" : "other"); }
  console.log(JSON.stringify(a), JSON.stringify(b), a === b);
}
for (const bad of bads()) {
  try { show(bad); console.log("no throw"); } catch (e) { console.log("throws", (e instanceof TypeError ? "TypeError" : "other")); }
}
console.log(both("x", ""), both("", "y"), both(1, ""), both("", 2));
const m = new Map<string, unknown>();
console.log(attr({ set: (k: string, v: unknown) => m.set(k, v), get: (k: string) => m.get(k) }, "v1"), attr({ set: (k: string, v: unknown) => m.set(k, v), get: (k: string) => typeof m.get(k) }, 42));
console.log(same("abc"), same(""), sideEffects());
// A dyn value checked as a string and handed back to untyped code (typed string in between).
const fromAny = (x: any): string => '' + x;
const back = (s: any) => typeof s + ":" + s;
console.log(back(fromAny("q")), back(fromAny(5)), back(fromAny({ toString: () => "o" })));
