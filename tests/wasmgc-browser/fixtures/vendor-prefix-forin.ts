// @expect: animationend transitionend click animationend
// React DOM's module init (getVendorPrefixedEventName): the WasmGC dev page's renderer ran out of memory here.
import { names } from "./vendor-prefix-forin-helper.js";
console.log(names.join(" "));
