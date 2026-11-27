// @options: {"hostHandles": true}
import { makeOwn, pageDelete } from "./js-page-delete-helper.js";
const h: any = globalThis;
const frozen = h.auditMake2(); h.auditFreeze(frozen);
console.log(pageDelete(h.auditMake(), h.auditMakeArray(), frozen, makeOwn(), (o: unknown) => h.auditKeys(o)));
