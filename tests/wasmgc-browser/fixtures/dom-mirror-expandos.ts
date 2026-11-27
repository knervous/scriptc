// @native-only: experimentalDomMirror is a native-model compile option
// @options: {"experimentalDomMirror": true}
// @hits(native,native-any): ^\$dom\.isExpando$
// @hits(native,native-any): ^\$dom\.expandoSet$
// @profile: experimentalDomMirror keeps compiled expandos (keys no DOM interface defines) of nodes compiled code created in Wasm: page code does not see them, and compiled code does not see such keys the page sets on those nodes; DOM members (id) and page nodes keep their properties on the node
// @expect: 1 2 true true true x - undefined x  false 3  false 2 5 true  false 2 - t 1 1 
import { expandos } from "./dom-mirror-expandos-helper.js";
const p: any = (globalThis as any).auditRealDom();
console.log(expandos(p));
