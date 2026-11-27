// Page arrays in compiled code: Array.isArray recognises them, and a typed
// array slot copies one in (foreign arrays do not keep identity, by profile).
import { pageArrays } from './r6-accessor-helper.js';
const h: any = globalThis;
const arr: any = h.auditMakeArray();
function take(item: { tags: number[] }): string { return item.tags.length + ":" + item.tags.join("+"); }
console.log(pageArrays(arr, take));
