// Constant union values (null arms, literal numbers and booleans) shared as immutable values:
// equality, narrowing, storage and conversion to untyped code see values, never identities.
type N = number | null;
type S = string | number | boolean | null;
function pick(i: number): N { if (i === 0) return null; if (i === 1) return 5; if (i === 2) return -0; return i; }
function pickS(i: number): S { if (i === 0) return null; if (i === 1) return true; if (i === 2) return 7; if (i === 3) return false; return "s" + i; }
const ns: N[] = [];
for (let i = 0; i < 4; i++) ns.push(pick(i));
ns.push(null, 5, -0);
const out: string[] = [];
for (let i = 0; i < ns.length; i++) for (let j = 0; j < ns.length; j++) if (i < j && ns[i] === ns[j]) out.push(`${i}=${j}`);
console.log(out.join(","));
console.log(ns.map(v => v === null ? "null" : Object.is(v, -0) ? "-0" : String(v)).join(","));
const ss: S[] = [pickS(0), pickS(1), pickS(2), pickS(3), pickS(4), null, true, 7, false];
console.log(ss.map(v => typeof v + ":" + String(v)).join(","));
let eq = 0;
for (const a of ss) for (const b of ss) if (a === b) eq++;
console.log(eq);
const anyView: any[] = ss.map(v => v as any);
console.log(anyView.filter(v => v === null).length, anyView.filter(v => v === true).length, anyView.map(v => String(v)).join("|"));
function maybe(flag: boolean): N { let r: N = null; if (flag) r = 3; return r; }
let total = 0;
for (let i = 0; i < 6; i++) { const v = maybe(i % 2 === 0); if (v !== null) total += v; }
console.log(total, maybe(false) === maybe(false), maybe(true) === maybe(true));
