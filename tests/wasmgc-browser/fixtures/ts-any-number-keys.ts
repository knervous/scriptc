// @native-any-only: compound and update assignments on elements of TS any values are dyn only when TS any is native
// @hits(native-any): dyn\.class\.index\.get$
// @hits(native-any): dyn\.class\.index\.set$
// Number keys through TS any: the React Compiler memo cache ($[k] reads,
// writes and sentinel checks), number locals, holes, appends past the end,
// out-of-range, negative and fractional keys, NaN/Infinity/-0, number keys on
// objects and strings, TS arrays and page arrays held in any, and string keys
// that look numeric.
const h: any = globalThis;
const sentinel = Symbol.for("memo.sentinel");
function memo(size: number): any { const $: any = []; for (let i = 0; i < size; i++) $[i] = sentinel; return $; }
function render($: any, a: number, b: string): string {
  let t;
  if ($[0] !== a || $[1] !== b) { t = b + a; $[0] = a; $[1] = b; $[2] = t; } else t = $[2];
  return t;
}
const $ = memo(3);
console.log(render($, 1, "x"), render($, 1, "x"), render($, 2, "x"), $.length, $[3], $[-1], $[1.5], $[2]);

const arr: any = [1, 2, 3];
arr[4] = 5;
console.log(arr[3], 3 in arr, arr[4], arr.length, arr[5]);
arr[5] = 6; arr[3] = 4;
console.log(arr.length, arr[3], 3 in arr, arr[5]);
const i: number = 2;
arr[i] += 10; arr[i]++;
console.log(arr[i], arr[i]--, arr[i], --arr[i]);
let k = 0;
arr[k++] = arr[k++] + 100;
console.log(k, arr[0], arr[1]);
const chained = arr[0] = arr[1] = arr["2"] = 7;
console.log(chained, arr[0], arr[1], arr[2]);
console.log(arr["1"], arr["01"], arr[" 1"], arr["1.0"], arr[""]);
const n: any = 1, frac: any = 2.5, neg: any = -1;
console.log(arr[n], arr[frac], arr[neg], arr[-0], arr[NaN]);

const o: any = { 0: "zero", 1: "one", "1.5": "frac", "-1": "neg" };
console.log(o[0], o[1], o[1.5], o[-1], o[2], o["0"], o[n], o[frac], o[-0]);
o[2] = "two"; o[1.5] = "f2"; o[-1] = "n2"; o[NaN] = "nan"; o[Infinity] = "inf";
console.log(Object.keys(o).join(","), o[2], o["1.5"], o["-1"], o.NaN, o["Infinity"], o[0 / 0]);
o[3] ??= "three"; o[0] ??= "kept"; o[4] ||= "four"; o[1] &&= "ONE";
console.log(o[3], o[0], o[4], o[1]);

const typed: number[] = [7, 8, 9]; const t: any = typed;
console.log(t[0], t[2], t[3], t[i], t.length);
t[1] = 80; t[i] += 1; t[3] = 10;
console.log(typed[1], typed[2], typed.length, typed[3], t[3], t[4]);

const page: any = h.auditMakeArray();
console.log(page[0], page[1], page[2], page[i - 1]);
page[1] = 20;
console.log(h.auditArrayN(), page[1]);

const s: any = "hey";
console.log(s[0], s[i], s[3], s[-1], s[n], s[frac]);
