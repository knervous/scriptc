// Array callbacks: the direct loop for statically known closures and the
// generic $dyn.call3 walk must agree on arguments, this, results and errors.
// @native-only: the engine lane loses rest parameters of JS callbacks and extracted class methods (pre-existing)
import { calls } from "./audit-callback-calls-helper.js";
const h: any = globalThis;
console.log(calls(h.auditIdentity));
// TS any arrays with typed closures (native-any direct loops).
const tryIt = (label: string, f: () => any) => { try { console.log(label, String(f())); } catch (e) { console.log(label, "throw", (e as Error).name, (e as Error).message); } };
const mk = (): any => [1, 2, 3, 4];
tryIt("p0", () => mk().map(() => 7).join());
tryIt("p3", () => mk().map((x: any, i: any, a: any) => x + i + a.length).join());
tryIt("p4", () => mk().map((x: any, i: any, a: any, extra: any) => [x, i, a.length, extra].join("/")).join());
tryIt("dflt", () => mk().map((x: any, i: any = 100) => x + i).join());
tryIt("thisArg", () => mk().find((x: any) => x === 3, { k: 1 }));
tryIt("throwFind", () => mk().find((x: any) => { if (x === 2) throw new TypeError("at2"); return false; }));
tryIt("numPred", () => mk().filter((x: any) => x - 2).join());
tryIt("nanPred", () => mk().filter((x: any) => x === 1 ? NaN : x).join());
tryIt("strPred", () => mk().filter((x: any) => x > 2 ? "y" : "").join());
tryIt("objPred", () => mk().find((x: any) => x > 2 ? {} : null));
tryIt("negZero", () => mk().some(() => -0));
tryIt("boolMap", () => mk().map((x: any) => x > 2).join());
tryIt("voidMap", () => mk().map((_x: any) => { }).join("|"));
const eq = (v: any) => (x: any) => x === v;
tryIt("factory", () => [mk().findIndex(eq(1)), mk().findIndex(eq(4)), mk().findIndex(eq("4"))].join());
let cb = (x: any) => x === 1;
tryIt("swapBefore", () => mk().findIndex(cb));
cb = (x: any) => x === 4;
tryIt("swapAfter", () => mk().findIndex(cb));
const holder: any = { f: (x: any) => x > 2 };
const pulled: (x: any) => boolean = holder.f;
tryIt("pulled", () => mk().filter(pulled).join());
tryIt("pageFn", () => mk().map(h.auditIdentity).join());
tryIt("pageArr", () => h.auditMakeArray().map((x: any, i: any) => x + i).join());
