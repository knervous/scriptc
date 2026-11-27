// Constructor structs (experimentalJsConstructorStructs): objects of recognized JS constructors keep
// JS semantics everywhere: fields, order, enumeration, prototypes, expandos, delete, attributes,
// calls without new or on other receivers, prototype-chain subclasses, and the page's view.
// @options: {"experimentalJsConstructorStructs":true}
// @native-only: experimentalJsConstructorStructs is a native-dyn compile option
// @hits(native,native-any): ^\$ctor\.\d+\.new$
// @hits(native,native-any): ^\$ctor\.demote$
// @hits(native,native-any): ^\$ctor\.get$
import { basics, reshape, calls, make, readBack } from './js-ctor-structs-helper.js';
const h: any = globalThis;
console.log(basics());
console.log(reshape());
console.log(calls());
const v: any = make(21, "page");
console.log(h.auditCtorObject(v));
console.log(readBack(v));
