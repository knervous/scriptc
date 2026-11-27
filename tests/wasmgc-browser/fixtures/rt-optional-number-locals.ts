// `number | undefined` locals are held as f64 with the undefined NaN (agent RT, 10-28, optional-number.ts): Map.get
// results, optional fields, absence-probed reads, `let x;` and `var` before assignment, ?? defaults, === between two
// optional numbers (two undefineds equal, NaN never), escapes into arrays, records, parameters and closures, typeof,
// String, and loops that reassign.
interface Rec { score?: number; name: string }
const m = new Map<string, number>([["a", 1], ["nan", NaN], ["zero", -0]]);
function look(k: string): string {
  const hit = m.get(k);
  if (hit === undefined) return `${k}:miss`;
  return `${k}:${hit + 1}:${typeof hit}:${Object.is(hit, -0)}`;
}
console.log(["a", "b", "nan", "zero"].map(look).join(" "));
function fallback(k: string): number { const v = m.get(k); return v ?? 42; }
console.log("??", fallback("a"), fallback("b"), fallback("nan"));
const recs: Rec[] = [{ score: 3, name: "x" }, { name: "y" }, { score: 0, name: "z" }];
let best: number | undefined;
for (const r of recs) { const s = r.score; if (s !== undefined && (best === undefined || s > best)) best = s; }
console.log("best", best, typeof best);
function pair(a: number | undefined, b: number | undefined): string {
  const x = a, y = b;
  return `${x === y}/${x !== y}/${Object.is(x, y)}`;
}
console.log("eq", pair(undefined, undefined), pair(1, 1), pair(NaN, NaN), pair(1, undefined), pair(0, -0));
function declared(flag: boolean): string {
  let v: number | undefined;
  const before = String(v);
  if (flag) v = 7;
  return `${before}->${String(v)}:${v === undefined}`;
}
console.log("let", declared(false), declared(true));
function hoisted(n: number): string {
  const seen: string[] = [];
  for (let i = 0; i < n; i++) { seen.push(String(w)); var w: number | undefined = i * 2; }
  return seen.join(",");
}
console.log("var", hoisted(3));
function escapes(k: string): string {
  const v = m.get(k);
  const arr: (number | undefined)[] = [v, v];
  const rec: { v?: number } = { v };
  const id = (x: number | undefined) => x;
  const later = () => v;
  return `${arr.length}:${arr[0]}:${rec.v}:${id(v)}:${later()}`;
}
console.log("escape", escapes("a"), escapes("b"));
const probe: number[] = [5, 6];
function probed(i: number): string { const v = probe[i] as number | undefined; return v === undefined ? "none" : `got ${v}`; }
console.log("probe", probed(0), probed(1), probed(2));
function sumOpt(xs: (number | undefined)[]): number { let total = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]; if (x !== undefined) total += x; else total -= 100; } return total; }
console.log("sum", sumOpt([1, undefined, 2, undefined]));
function cycle(): string {
  let v: number | undefined = 1;
  const out: string[] = [];
  for (let i = 0; i < 4; i++) { out.push(`${v}`); v = v === undefined ? i : i % 2 ? undefined : v + 10; }
  return out.join(",");
}
console.log("cycle", cycle());
function arith(k: string): number { const v = m.get(k); return v === undefined ? -1 : v * 2; }
console.log("arith", arith("a"), arith("b"));
