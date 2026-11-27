"use strict";
// @native-only: the engine dyn model has no runtime freeze of a compiled record
// A frozen record's keyed write names the real key, in the declared fields and the overflow map alike; a frozen array's element write
// and append carry Node's text.
type R = Record<string, number>;
const r: R = Object.freeze({ a: 1 }) as R;
const keys = ["a", "b", "key", "x-y"];
for (const k of keys) {
  try { r[k] = 9; console.log("no throw", k); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
}
console.log(JSON.stringify(r), Object.isFrozen(r));
const arr: number[] = Object.freeze([1, 2]) as number[];
try { arr[0] = 3; } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { arr[5] = 3; } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { arr.push(3); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
