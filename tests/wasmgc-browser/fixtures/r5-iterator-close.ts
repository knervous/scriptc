import { first } from './r5-helper.js';
const h: any = globalThis;
const value: number = first(h.auditIterator());
console.log(value, h.auditClosed());
