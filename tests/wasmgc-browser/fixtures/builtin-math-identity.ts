// @native-any-only: a page global read through untyped code (the engine and plain native lanes keep these values in the page)
// On the web host a Math member read as a value is the page's own function, adopted at module start: a page read made BEFORE
// any compiled read already is the compiled closure's page form, so identity holds in both directions.
const g2: any = globalThis;
const pageMax = g2.Math.max, pageLog = g2.Math.log, pageHypot = g2.Math.hypot;
var log = Math.log, mx = Math.max;
console.log(pageLog === log, pageMax === mx, pageHypot === Math.hypot, g2.Math.log(Math.E), g2.Math.hypot(3, 4));
g2.seen = log;
console.log(g2.seen === g2.Math.log, typeof g2.Math.log, g2.Math.log.call(null, 1), pageMax(1, 7, 3));
