// A dyn facade's Proxy target (DynTarget) is invisible to the page except
// through symbol keys: inherited symbols, toStringTag and own symbols
// behave as on a facade over a plain {} or [].
import { make, after } from "./js-dyn-facade-target-helper.js";
const h: any = globalThis;
const pair: any = make();
const o: any = pair[0], arr: any = pair[1];
console.log(h.auditFacadeTarget(o, arr));
console.log(after(o, arr));
