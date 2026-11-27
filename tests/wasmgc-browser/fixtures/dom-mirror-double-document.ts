// @native-only: experimentalDomMirror is a native-model compile option
// @options: {"experimentalDomMirror": true}
// experimentalDomMirror on a test-double document (plain objects, Proxies, overridden members, failures): a receiver that is not a
// mirrored node takes the page path (it used to trap with an illegal cast in the setAttribute fast path).
import { build, overrides, failures, compiled } from "./js-page-dom-direct-helper.js";
const h: any = globalThis;
console.log(build(h.auditDom()));
console.log(overrides(h.auditDom()));
console.log(failures(h.auditDom()));
console.log(compiled(h.auditDom(), h));
