// @native-any-only: ++/-- on TS any bindings compile only where TS any is a native dyn value
// ToPrimitive of TS literals held as native dyn values (typed records and
// typed arrays): compound assignment, ++/--, +, *, templates, == and <
// call valueOf/toString or join, as JS does, instead of answering NaN.
const tryIt = (label: string, f: () => any) => { try { console.log(label, String(f())); } catch (e) { console.log(label, "throw", (e as Error).name, (e as Error).message); } };
const vals: any = [{}, { valueOf() { return 9; } }, { toString() { return "7"; } }, [3], [1, 2], [], { valueOf() { return "5"; } }];
for (const v of vals) {
  tryIt("plusEq", () => { let x: any = v; x += 1; return typeof x + ":" + String(x); });
  tryIt("mulEq", () => { let x: any = v; x *= 2; return String(x); });
  tryIt("inc", () => { let x: any = v; x++; return String(x); });
  tryIt("dec", () => { let x: any = v; --x; return String(x); });
  tryIt("plus", () => { const x: any = v; return String(x + 1); });
  tryIt("mul", () => { const x: any = v; return String(x * 2); });
  tryIt("tmpl", () => { const x: any = v; return `${x}`; });
  tryIt("concat", () => { const x: any = v; return "" + x; });
  tryIt("eq", () => { const x: any = v; return String(x == 9) + String(x == "[object Object]") + String(x == 3); });
}
const nums: any = [4, 5];
tryIt("arrPlus", () => nums + "|" + (nums * 1) + "|" + `${nums}`);
