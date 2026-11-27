// push and pop on typed arrays at their sites: a hole or a present undefined at the end pops as undefined, an
// empty array pops undefined, pushes past the capacity grow, and pop then push reuses the slot as a fresh value.
const a: number[] = [1, 2];
a.length = 4;
console.log(String(a.pop()), String(a.pop()), String(a.pop()), a.length, 3 in a);
const b: (number | undefined)[] = [1, undefined];
console.log(String(b.pop()), String(b.pop()), String(b.pop()), String(b.pop()), b.length);
const c: string[] = ["x"];
c.length = 2;
console.log(String(c.pop()), String(c.pop()), String(c.pop()));
const d: number[] = [];
let s = 0;
for (let i = 0; i < 100; i++) d.push(i * 0.5, -i);
console.log(d.length, d[0], d[199], 1 / d[1]!);
while (d.length) s += d.pop()!;
console.log(s, d.length, String(d.pop()));
const e: number[] = [NaN, -0];
const z = e.pop()!, n = e.pop()!;
console.log(Object.is(z, -0), Number.isNaN(n), e.length);
const f: number[] = [7];
f.length = 3;
f.push(9);
console.log(f.length, 1 in f, 3 in f, f[3], f.join("|"));
f.pop(); f.pop(); f.push(4);
console.log(f.length, f.join("|"), 1 in f, 2 in f);
interface P { n: number }
const ps: P[] = [];
for (let i = 0; i < 5; i++) ps.push({ n: i });
let t = 0;
for (let i = 0; i < 7; i++) { const p = ps.pop(); t += p === undefined ? 100 : p.n; }
console.log(t, ps.length);
const g: number[] = [1, 2, 3];
let popped = 0;
for (let i = 0; i < 3; i++) { const v = g.pop(); popped += v ?? 0; g.length = Math.max(0, g.length); }
console.log(popped, String(g.pop() ?? "none"));
export {};
