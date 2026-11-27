// @options: {"hostHandles": true}
// Math members read as values compile to constants and compiled closures (React DOM's clz32: var log = Math.log, LN2 = Math.LN2).
var log = Math.log, LN2 = Math.LN2;
const clz = (x: number): number => 31 - (log(x >>> 0) / LN2 | 0);
console.log(clz(1000), clz(1), Math.E, Math.LN10, Math.LOG2E, Math.LOG10E, Math.PI, Math.SQRT1_2, Math.SQRT2);
const M = Math;
const f = M.max, g = Math.pow, h = Math.hypot;
console.log(M.sqrt(16), f(1, 5, 3), g(2, 10), h(3, 4), Math.max === Math.max, log === Math.log, M.log === log, typeof Math.min);
const fns = [Math.abs, Math.floor, Math.sign, Math.trunc, Math.atan2, Math.imul];
console.log(fns.map(fn => String(fn(-2.5, 3))).join(","));
