// @native-only: experimentalDomMirror is a native-model compile option
// @options: {"experimentalDomMirror": true}
// experimentalDomMirror: structure answered in Wasm, page code changing
// mirrored nodes between and during compiled work, failing DOM operations,
// page overrides of DOM methods, custom elements and attribute stores, all
// on a real DOM (jsdom): every line must match Node exactly.
// @hits(native,native-any): ^\$dom\.make\.createElement$
// @hits(native,native-any): ^\$dom\.insert\.appendChild$
// @hits(native,native-any): ^\$dom\.insert\.insertBefore$
// @hits(native,native-any): ^\$dom\.read\.firstChild$
// @hits(native,native-any): ^\$dom\.read\.nextSibling$
// @hits(native,native-any): ^\$dom\.set\.textContent$
import { structure, pageMutations, failures, overrides, attributes, entries, reentry } from "./dom-mirror-helper.js";
const p: any = (globalThis as any).auditRealDom();
console.log(structure(p));
console.log(pageMutations(p));
console.log(failures(p));
console.log(overrides(p));
console.log(attributes(p));
console.log(entries(p));
console.log(reentry(p));
