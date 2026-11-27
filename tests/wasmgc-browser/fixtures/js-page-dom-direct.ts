// DOM members by name (DOM_DIRECT, js.dom.* host imports): page receivers
// are exact for overrides, plain objects, proxies, failures and compiled
// values; compiled receivers keep the compiled path.
// @hits(native,native-any): ^\$dyn\.domSet\.textContent$
// @hits(native,native-any): ^\$dyn\.invoke\.appendChild\.1$
import { build, overrides, failures, compiled } from "./js-page-dom-direct-helper.js";
const h: any = globalThis;
console.log(build(h.auditDom()));
console.log(overrides(h.auditDom()));
console.log(failures(h.auditDom()));
console.log(compiled(h.auditDom(), h));
