// @hits(native,native-any): dyn\.arr\.ctor$
// The Array constructor in untyped JS builds a native dyn array (holes, the
// given length, invalid-length RangeErrors, single and several arguments),
// and React Compiler's memo-cache reads and writes through TS any see the
// same values. Array.from({ length }): js-array-from-length.
import { report, useMemoCache, resetMemo, holeArrays } from "./js-array-ctor-native-helper.js";
console.log(report());
const h: any = globalThis;
for (const a of holeArrays()) h.auditHoles(a);
function render(t0: any, label: string): string {
  const $: any = useMemoCache(4);
  let t1: any;
  if ($[0] !== t0 || $[1] !== label) { t1 = label + ":" + t0; $[0] = t0; $[1] = label; $[2] = t1; } else t1 = $[2];
  $[3] = (typeof $[3] === "number" ? $[3] : 0) + 1;
  return t1 + "/" + $[3] + "/" + $.length;
}
const outs: string[] = [];
const values = [1, 1, 2, 2], labels = ["a", "a", "a", "b"];
for (let i = 0; i < values.length; i++) { resetMemo(); useMemoCache(3); outs.push(render(values[i]!, labels[i]!)); }
console.log(outs.join(" "));
