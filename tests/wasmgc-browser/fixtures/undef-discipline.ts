const a = new Float64Array(1);
const u = a[3];
function id(x: number): number { return x; }
const xs = [u, 1];
console.log(id(u), xs[0], xs.length, Object.is(u, u), Object.is(u, NaN), Object.is(NaN, NaN), Object.is(0, -0));
console.log(u < 1, u > 1, u !== u, u === xs[0], Math.max(u, 1), Math.min(1, u), -u, u * 2);
console.log(u || 3, !u, u ? "t" : "f", JSON.stringify([u]), new Float32Array(1)[5], `${id(u)}`);
const h: any = globalThis;
const raw: number = h.auditNaNBits();
console.log(typeof raw, String(raw), Number.isNaN(raw), raw === raw, Math.abs(raw));
