// N4: compiled objects/arrays as live page objects (identity, writes both ways, keys, JSON, methods, holes).
import { facadeMake, facadeCheck } from './r4-helper.js';
const h: any = globalThis;
const o = facadeMake();
const page: string = h.auditFacade(o);
const after: string = facadeCheck(o, h.auditFacadeKept());
console.log(page + " | " + after);
