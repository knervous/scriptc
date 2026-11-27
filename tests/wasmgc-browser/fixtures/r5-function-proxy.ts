import { fn, call } from './r5-helper.js';
const h: any = globalThis;
const result: number = call(h.auditProxy(fn()));
console.log(result);
