// Array.prototype.map keeps the source length; trailing holes stay holes.
const h: any = [1, 2, 3];
h[5] = 6;
h.length = 8;
const m = h.map((x) => x * 2), g = h.map((x) => "" + x);
console.log(m.length, g.length, 7 in m, m.join("|"));
