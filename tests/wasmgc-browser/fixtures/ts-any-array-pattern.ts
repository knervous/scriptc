// @hits(native-any): \$dyn\.arr\.patternAt
// Array patterns over TS any (React's `const [value, setValue] = useState()`).
// A compiled array binds its elements directly while the page's array
// iteration protocol is the engine's own: values, holes, positions past the
// end, closures and identity. Every other source (strings, Sets, page arrays,
// null), and every array once the page replaces the iterator, installs a
// getter for it, replaces next, or adds a return method (own or inherited),
// runs the real protocol, as does an array that has crossed to the page.
import { arr, holes, pageSet, fnPair } from "./ts-any-array-pattern-helper.js";
const page: any = globalThis;
function pair(t0: any) { const [a, b] = t0; return String(a) + ":" + String(b); }
function skip(t0: any) { const [, b, , d] = t0; return String(b) + ":" + String(d); }
function one(t0: any) { const [a] = t0; return String(a); }
const out: string[] = [];
for (let i = 0; i < 3; i++) out.push(pair(arr(i, i * 2)));
out.push(pair(arr(1)), pair(arr()), pair(arr(1, 2, 3)), skip(arr(1, 2, 3, 4, 5)), skip(arr(1, 2)), one(holes()), pair(holes()));
out.push(pair("xy"), pair(pageSet(7, 8)), pair(JSON.parse("[5,6]")), pair(page.auditMakeArray()));
const f = () => 1;
function both(t0: any) { const [g, h] = t0; return String(g === f) + " " + String(h()); }
out.push(both(fnPair(f)));
function useThing(t0: any) { const [value, set] = t0; set(value + 1); return value; }
let seen = 0;
out.push(String(useThing(arr(41, (v: number) => { seen = v; }))), String(seen));
function tryPair(v: any) { try { return pair(v); } catch (e) { return (e as Error).name; } }
out.push(tryPair(null), tryPair(undefined), tryPair(5), tryPair({}));
console.log(out.join(" "));
for (const mode of ["values", "getter", "next", "return", "inherited"]) {
  let line = "";
  page.w5Patch(mode);
  try { line = [mode, pair(arr(1, 2)), pair(arr(3)), one(arr(4, 5)), skip(arr(6, 7, 8, 9))].join(" "); } finally { page.w5Patch("restore"); }
  console.log(line, page.w5Hits());
}
console.log("restored", pair(arr(1, 2)), page.w5Hits());
const kept = arr(3, 4);
page.auditKeep(kept);
console.log("kept", pair(kept));
