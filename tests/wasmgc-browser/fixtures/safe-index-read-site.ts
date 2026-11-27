// A safe element read `a[i]` (no `!`) inside a loop reads the slot at its site: holes, present undefined,
// indices past either end, fractions, NaN and -0, element kinds that box to a union, arrays that grow and shrink
// mid-loop, and the receiver-then-index evaluation order.
type Fn = (x: number) => number;
const fns: Fn[] = [(x) => x + 1, (x) => x * 2, (x) => x - 1];
const target = fns[1];
let hits = 0, misses = 0;
for (let i = -2; i < 6; i++) { const f = fns[i]; if (f === target) hits++; if (f === undefined) misses++; }
console.log("fns", hits, misses);

interface P { n: number }
const ps: P[] = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
ps.length = 6;
ps[7] = { n: 8 };
const seen: string[] = [];
for (let i = 0; i < 9; i++) { const p = ps[i]; seen.push(p === undefined ? "u" : String(p.n)); }
console.log("holes", seen.join(","), 1 in ps, 4 in ps);

const keys = [0.5, NaN, -0, -1, 2 ** 31, 3, 1e300, Infinity];
const out: string[] = [];
for (const k of keys) { const p = ps[k]; out.push(p === undefined ? "u" : String(p.n)); }
console.log("odd keys", out.join(","));

const maybe: (P | undefined)[] = [{ n: 7 }, undefined, { n: 9 }];
maybe[4] = { n: 11 };
let present = 0, undef = 0;
for (let i = 0; i < 6; i++) { const v = maybe[i]; if (v === undefined) undef++; else present += v.n; }
console.log("present undefined", present, undef, 1 in maybe, 3 in maybe);

const words = ["a", "b", "c"];
let text = "";
for (let i = 0; i < 5; i++) { const w = words[i]; text += w === undefined ? "-" : w; text += typeof w; }
console.log("strings", text);

const flags = [true, false];
let fl = "";
for (let i = 0; i < 3; i++) fl += String(flags[i]) + " ";
console.log("bools", fl);

const mixed: (number | string)[] = [1, "two", 3];
const ms: string[] = [];
for (let i = 0; i < 4; i++) { const v = mixed[i]; ms.push(typeof v + ":" + String(v)); }
console.log("union elements", ms.join(" "));

const grow: P[] = [{ n: 0 }];
let count = 0;
for (let i = 0; i < 10; i++) { const g = grow[i]; if (g === undefined) break; count += g.n; if (grow.length < 5) grow.push({ n: i + 1 }); }
console.log("grow", count, grow.length);
const shrink: P[] = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
let sum = 0;
for (let i = 0; i < 4; i++) { const s = shrink[i]; sum += s === undefined ? 100 : s.n; shrink.pop(); }
console.log("shrink", sum, shrink.length);

let current: P[] = [{ n: 10 }, { n: 20 }];
const other: P[] = [{ n: 30 }, { n: 40 }];
const order: string[] = [];
for (let i = 0; i < 2; i++) {
  const r = current[(current = other, i)];
  order.push(String(r?.n));
}
console.log("order", order.join(","));

const ints: number[] = [5, 6, 7];
ints[5] = 9;
let isum = 0, iholes = 0;
for (let i = 0; i < 7; i++) { const v = ints[i]; if (v === undefined) iholes++; else isum += v; }
console.log("numbers", isum, iholes);
const walked: string[] = [];
for (const p of ps) walked.push(p === undefined ? "u" : String(p.n));
for (const v of ints) walked.push(String(v));
const live = [1, 2, 3];
for (const v of live) { walked.push(String(v)); if (live.length < 6) live.push(v * 10); if (v === 20) live.length = 5; }
console.log("for-of", walked.join(","));
export {};
