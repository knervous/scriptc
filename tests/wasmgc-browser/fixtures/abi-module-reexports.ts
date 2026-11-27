// Re-exported module functions (renamed, `export *`, a re-exported default) on the i32 and atom ABIs: called directly
// with int32s and literals through every name, and reached as values with fractional doubles and run-time strings.
import { halve, mix, plus, gaitSpeed, nextGait } from "./abi-module-ns-lib/relay.ts";
import * as relay from "./abi-module-ns-lib/relay.ts";
import { half } from "./abi-module-ns-lib/ops.ts";

console.log(halve(10), half(6), mix(2, 3), plus(4, 5), gaitSpeed("run"), nextGait("idle"));
const built = ["ru", "n"].join("") as "run";
const r = relay as typeof relay;
console.log(r.halve(3), r.half(1), r.plus(0.5, 0.25), r.mix(1.5, 1), r.gaitSpeed(built), r.nextGait(built));
const fns = [halve, relay.plus, relay.half];
console.log(fns.map((fn) => fn(2.5, 0.5)).join(","));
