// Accessor properties on compiled objects: receiver, descriptors, order, exceptions,
// inheritance, redefinition, React's passive-listener test, and the page facade.
import { accessors } from './r6-accessor-helper.js';
const h: any = globalThis;
console.log(accessors(h.auditAccessorPage()));
