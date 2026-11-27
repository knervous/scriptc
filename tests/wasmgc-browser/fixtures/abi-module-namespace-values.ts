// Module functions (`%mN.<name>`) on the i32 and atom ABIs: direct calls pass int32s and literals, while a namespace
// object used as a value, a namespace member read by a computed key, a function value taken from a namespace, and a
// dynamic import reach the same functions with fractional doubles and run-time strings (the wide ABI).
import * as ops from "./abi-module-ns-lib/ops.ts";
import { half, mix, gaitSpeed, nextGait, scaleBy, tagOf, type Gait } from "./abi-module-ns-lib/ops.ts";

let acc = 0;
for (let i = 0; i < 8; i++) acc = mix(acc, i);
console.log(acc, half(8), gaitSpeed("walk"), nextGait("run"), scaleBy(3, 4), tagOf("idle", 2));

// The namespace as a value: stored, passed, read by a computed key.
const holder: { ns: typeof ops } = { ns: ops };
type Ns = typeof ops;
const loose = ops as Ns;
const key = ["ha", "lf"].join("") as "half";
const mixKey = ["mi", "x"].join("") as "mix";
const built = ["wa", "lk"].join("") as Gait;
console.log(holder.ns.half(5), loose[key](7), loose[mixKey](1.5, 2.25), holder.ns.scaleBy(0.5, 3));
console.log(holder.ns.gaitSpeed(built), loose.nextGait(built), loose.tagOf(built, 1.5), ops.gaitSpeed(built));

// A function value taken from the namespace and from a named import.
const f: (n: number) => number = ops.half, g = scaleBy;
console.log(f(3), g(2.5, 2), [1, 2.5, -3].map(ops.half).join(","), [ops.mix][0]!(0.5, 1));

// Object.keys of the namespace, and a member read through a key from that list.
const names = Object.keys(ops).sort();
const scaleKey = names.find((k) => k.startsWith("scale")) as "scaleBy";
console.log(names.join(","), ops[scaleKey](1.5, 3));

import("./abi-module-ns-lib/ops.ts").then((ns) => {
  console.log(ns === ops, ns.half(11), ns.mix(2.5, 0.25), ns.gaitSpeed(built), ns.tagOf(ns.nextGait("idle"), 0.5));
});
