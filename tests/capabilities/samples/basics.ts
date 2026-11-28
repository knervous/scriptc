class P { constructor(public x: number, public y: number) {} }
const ps: P[] = [];
for (let i = 0; i < 10; i++) ps.push(new P(i, i * 2));
let s = 0;
for (const p of ps) s += p.x + p.y;
try { if (s > 10) throw new Error("big " + s); } catch (e) { console.log("caught", (e as Error).message); }
const b = new Uint8Array(16); b[3] = 7;
console.log("sum", s, b[3], "héllo".length);
