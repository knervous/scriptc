// Page traps over several compiled objects and arrays at once: reads, writes,
// foreign receivers (another facade, an inheriting object, a plain object),
// symbols, attributes, accessors, deletes and array lengths, then identity
// and the compiled side's view of the page's writes.
import { objects, readBack } from './host-facade-traps-helper.js';
const h: any = globalThis;
const os: any = objects();
const a: any = os[0], b: any = os[1], c: any = os[2], d: any = os[3];
console.log(h.auditFacadeTraps(a, b, c, d));
const kept: any = h.auditFacadeTrapsKept();
console.log(kept[0] === a, kept[1] === b, kept[2] === c, kept[3] === d, kept[0] === b);
console.log(readBack(a, b, c, d));
